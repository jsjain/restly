package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	goruntime "runtime"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"restly/internal/update"
)

// updater holds the update state. Its mutex is never held together with App.mu, and never across I/O.
type updater struct {
	mu      sync.Mutex // guards the fields below
	status  UpdateStatus
	release update.Release
	file    string // the downloaded asset, "" when there is none
	restart bool   // RestartToUpdate was called, so the install relaunches

	// Set before first use and read-only afterwards. Tests override them.
	feedURL string
	origin  *url.URL
	client  *http.Client
	target  update.Target
	dir     string
	emit    func(UpdateStatus)
	logf    func(format string, args ...any)
}

func newUpdater(feedURL string, origin *url.URL, emit func(UpdateStatus), logf func(format string, args ...any)) *updater {
	return &updater{
		status:  UpdateStatus{State: updateIdle},
		feedURL: feedURL,
		origin:  origin,
		// The default transport, so proxy environment variables apply.
		client: &http.Client{Timeout: updateClientTimeout},
		target: update.Target{Kind: update.KindNoticeOnly},
		emit:   emit,
		logf:   logf,
	}
}

// updateFeed returns the release feed and its trusted origin, the GitHub defaults unless override is a full URL.
func updateFeed(override string) (string, *url.URL) {
	if parsed, err := url.Parse(override); err == nil && parsed.Scheme != "" && parsed.Host != "" {
		return override, &url.URL{Scheme: parsed.Scheme, Host: parsed.Host}
	}
	// The default is a constant that parses.
	origin, _ := url.Parse(defaultUpdateOrigin)
	return defaultUpdateFeed, origin
}

// GetUpdateStatus returns the current update state.
func (app *App) GetUpdateStatus() UpdateStatus {
	return app.updates.snapshot()
}

// CheckForUpdates checks now in any mode and returns the final status, which is also sent as an event.
func (app *App) CheckForUpdates() UpdateStatus {
	return app.updates.check(app.ctx, true, app.updateSettings())
}

// DownloadUpdate downloads the available release and returns once it is ready to install.
func (app *App) DownloadUpdate() error {
	return app.updates.download(app.ctx)
}

// RestartToUpdate quits through the unsaved-changes prompt. The install and relaunch happen in shutdown.
func (app *App) RestartToUpdate() {
	app.updates.mu.Lock()
	app.updates.restart = true
	app.updates.mu.Unlock()
	if app.ctx != nil {
		runtime.Quit(app.ctx)
	}
}

// SkipUpdate stops the background check from offering version again.
func (app *App) SkipUpdate(version string) error {
	settings := app.GetSettings()
	settings.Update.Skipped = version
	if err := app.SaveSettings(settings); err != nil {
		return err
	}
	// A download in progress or ready keeps its state, so skipping cannot lose a pending install.
	app.updates.set(func(status *UpdateStatus) {
		if status.State == updateAvailable || status.State == updateError {
			status.State = updateIdle
		}
	})
	return nil
}

func (app *App) updateSettings() UpdateSettings {
	app.mu.Lock()
	defer app.mu.Unlock()
	return app.settings.Update
}

// startUpdates prepares the install target and starts the background checker.
func (app *App) startUpdates(ctx context.Context, dataDir string) {
	updates := app.updates
	exe, err := os.Executable()
	if err != nil {
		app.logError("failed to find the running executable, updates are notice only: %v", err)
	} else {
		updates.target = update.Detect(exe, goruntime.GOOS)
	}
	update.Cleanup(updates.target)
	updates.dir = filepath.Join(dataDir, updatesDir)
	// Downloads left by an earlier run are stale, and fetching again is cheap.
	if err := os.RemoveAll(updates.dir); err != nil {
		app.logError("failed to clear %s: %v", updates.dir, err)
	}
	go app.watchUpdates(ctx)
}

func (app *App) watchUpdates(ctx context.Context) {
	timer := time.NewTimer(updateFirstCheck)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		app.backgroundCheck(ctx)
		timer.Reset(updateInterval)
	}
}

// backgroundCheck does nothing when the user turned updates off.
func (app *App) backgroundCheck(ctx context.Context) {
	settings := app.updateSettings()
	if settings.Mode == updateOff {
		return
	}
	app.updates.check(ctx, false, settings)
}

// installUpdate runs in shutdown. A downloaded release installs after a restart request, or in auto mode.
func (app *App) installUpdate() {
	mode := app.updateSettings().Mode
	updates := app.updates
	updates.mu.Lock()
	ready, restart := updates.status.State == updateReady, updates.restart
	file, target := updates.file, updates.target
	updates.mu.Unlock()
	if !ready || (!restart && mode != updateAuto) {
		return
	}
	// The window context is already cancelled while quitting, so this one is not derived from it.
	if err := update.Install(context.Background(), target, file, restart); err != nil {
		app.logError("failed to install update %s: %v", file, err)
		if restart {
			if err := update.Relaunch(context.Background(), target); err != nil {
				app.logError("failed to restart Restly after a failed update: %v", err)
			}
		}
	}
}

func (updates *updater) snapshot() UpdateStatus {
	updates.mu.Lock()
	defer updates.mu.Unlock()
	return updates.status
}

// set applies change under the lock, then sends the new status.
func (updates *updater) set(change func(*UpdateStatus)) UpdateStatus {
	updates.mu.Lock()
	change(&updates.status)
	status := updates.status
	updates.mu.Unlock()
	updates.emit(status)
	return status
}

// begin moves to checking. It refuses while a check or download runs, or a download waits to install.
func (updates *updater) begin() (UpdateStatus, bool) {
	updates.mu.Lock()
	switch updates.status.State {
	case updateChecking, updateDownloading, updateReady:
		status := updates.status
		updates.mu.Unlock()
		return status, false
	}
	updates.status = UpdateStatus{State: updateChecking, CheckedAt: updates.status.CheckedAt}
	status := updates.status
	updates.mu.Unlock()
	updates.emit(status)
	return status, true
}

func (updates *updater) finishCheck(change func(*UpdateStatus)) UpdateStatus {
	return updates.set(func(status *UpdateStatus) {
		status.CheckedAt = time.Now().Format(time.RFC3339)
		change(status)
	})
}

func (updates *updater) failCheck(err error) UpdateStatus {
	updates.logf("failed to check for updates: %v", err)
	return updates.finishCheck(func(status *UpdateStatus) {
		status.State = updateError
		status.Error = err.Error()
	})
}

// check looks for a newer release. A manual check also offers a version the user skipped.
func (updates *updater) check(ctx context.Context, manual bool, settings UpdateSettings) UpdateStatus {
	if status, started := updates.begin(); !started {
		return status
	}
	info, err := buildAppInfo()
	if err != nil {
		return updates.failCheck(err)
	}
	release, err := update.Latest(ctx, updates.client, updates.feedURL)
	if err != nil {
		return updates.failCheck(err)
	}
	if !update.Newer(release.Version, info.Version) {
		return updates.finishCheck(func(status *UpdateStatus) { status.State = updateCurrent })
	}
	if !manual && release.Version == settings.Skipped {
		return updates.finishCheck(func(status *UpdateStatus) { status.State = updateIdle })
	}

	assetName := update.AssetName(updates.target.Kind, goruntime.GOARCH, release.Version)
	_, hasAsset := release.Assets[assetName]
	_, hasSums := release.Assets[updateChecksumsName]
	canInstall := updates.target.Kind != update.KindNoticeOnly && hasAsset && hasSums

	updates.mu.Lock()
	updates.release = release
	updates.mu.Unlock()
	status := updates.finishCheck(func(status *UpdateStatus) {
		status.State = updateAvailable
		status.Version = release.Version
		status.PageURL = release.PageURL
		status.CanInstall = canInstall
	})
	if canInstall && (settings.Mode == updateDownload || settings.Mode == updateAuto) {
		// download logs and publishes its own failure, so the returned status already shows it.
		_ = updates.download(ctx)
		return updates.snapshot()
	}
	return status
}

// download fetches the available release into dir. It does nothing when that version is already downloaded.
func (updates *updater) download(ctx context.Context) error {
	updates.mu.Lock()
	status, release, file := updates.status, updates.release, updates.file
	switch {
	case status.State == updateReady:
		updates.mu.Unlock()
		return nil
	case (status.State != updateAvailable && status.State != updateError) || !status.CanInstall || status.Version == "":
		updates.mu.Unlock()
		return errors.New("no update is available to download")
	}
	name := update.AssetName(updates.target.Kind, goruntime.GOARCH, release.Version)
	if file != "" && filepath.Base(file) == name {
		updates.status.State, updates.status.Error = updateReady, ""
	} else {
		updates.status.State, updates.status.Error = updateDownloading, ""
	}
	current := updates.status
	updates.mu.Unlock()
	updates.emit(current)
	if current.State == updateReady {
		return nil
	}

	path, err := update.Download(ctx, updates.client, release, name, updates.dir, updates.origin)
	if err != nil {
		err = fmt.Errorf("failed to download Restly %s: %w", release.Version, err)
		updates.logf("%v", err)
		updates.set(func(status *UpdateStatus) {
			status.State = updateError
			status.Error = err.Error()
		})
		return err
	}
	updates.mu.Lock()
	updates.file = path
	updates.mu.Unlock()
	updates.set(func(status *UpdateStatus) { status.State = updateReady })
	return nil
}
