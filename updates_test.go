package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	goruntime "runtime"
	"slices"
	"sync"
	"sync/atomic"
	"testing"

	"restly/internal/update"
)

const (
	newVersion = "99.0.0"
	oldBinary  = "old-binary"
	newBinary  = "new-binary"
)

// updateFixture is a test App wired to a fake release server and a temp executable to replace.
type updateFixture struct {
	app    *App
	exe    string
	hits   atomic.Int32
	errors []string
	mu     sync.Mutex
	events []UpdateStatus
}

type feedOptions struct {
	version   string // "" for newVersion
	status    int    // 0 for 200
	skipSums  bool
	skipAsset bool
}

func (fixture *updateFixture) states() []string {
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	states := make([]string, len(fixture.events))
	for i, event := range fixture.events {
		states[i] = event.State
	}
	return states
}

func tarGzWith(t *testing.T, name, content string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(content)), Typeflag: tar.TypeReg}); err != nil {
		t.Fatalf("failed to write tar header: %v", err)
	}
	if _, err := tw.Write([]byte(content)); err != nil {
		t.Fatalf("failed to write tar body: %v", err)
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("failed to close tar: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("failed to close gzip: %v", err)
	}
	return buf.Bytes()
}

func newUpdateFixture(t *testing.T, mode string, feed feedOptions) *updateFixture {
	t.Helper()
	version := feed.version
	if version == "" {
		version = newVersion
	}
	assetName := update.AssetName(update.KindLinuxTar, goruntime.GOARCH, version)
	asset := tarGzWith(t, "restly", newBinary)
	sum := sha256.Sum256(asset)
	sums := fmt.Sprintf("%s  %s\n", hex.EncodeToString(sum[:]), assetName)

	fixture := &updateFixture{app: newTestApp(t)}
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/latest":
			fixture.hits.Add(1)
			if feed.status != 0 {
				writer.WriteHeader(feed.status)
				return
			}
			assets := []map[string]string{}
			if !feed.skipAsset {
				assets = append(assets, map[string]string{"name": assetName, "browser_download_url": server.URL + "/asset"})
			}
			if !feed.skipSums {
				assets = append(assets, map[string]string{"name": updateChecksumsName, "browser_download_url": server.URL + "/sums"})
			}
			json.NewEncoder(writer).Encode(map[string]any{
				"tag_name": "v" + version,
				"html_url": server.URL + "/release",
				"assets":   assets,
			})
		case "/asset":
			writer.Write(asset)
		case "/sums":
			writer.Write([]byte(sums))
		default:
			http.NotFound(writer, req)
		}
	}))
	t.Cleanup(server.Close)

	origin, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("failed to parse server URL: %v", err)
	}
	fixture.exe = filepath.Join(t.TempDir(), "restly")
	if err := os.WriteFile(fixture.exe, []byte(oldBinary), 0o755); err != nil {
		t.Fatalf("failed to write fake executable: %v", err)
	}
	updates := fixture.app.updates
	updates.feedURL = server.URL + "/latest"
	updates.origin = origin
	updates.target = update.Target{Kind: update.KindLinuxTar, Path: fixture.exe}
	updates.dir = filepath.Join(t.TempDir(), updatesDir)
	updates.emit = func(status UpdateStatus) {
		fixture.mu.Lock()
		fixture.events = append(fixture.events, status)
		fixture.mu.Unlock()
	}
	updates.logf = func(format string, args ...any) {
		fixture.errors = append(fixture.errors, fmt.Sprintf(format, args...))
	}
	settings := fixture.app.GetSettings()
	settings.Update.Mode = mode
	if err := fixture.app.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings failed: %v", err)
	}
	return fixture
}

func assertFile(t *testing.T, path, want string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read %s: %v", path, err)
	}
	if string(got) != want {
		t.Errorf("%s holds %q, want %q", path, got, want)
	}
}

func TestCheckNotifyModeOffersWithoutDownloading(t *testing.T) {
	fixture := newUpdateFixture(t, updateNotify, feedOptions{})

	status := fixture.app.CheckForUpdates()

	if status.State != updateAvailable || status.Version != newVersion || !status.CanInstall || status.PageURL == "" || status.CheckedAt == "" {
		t.Fatalf("status = %+v, want an installable available %s", status, newVersion)
	}
	if _, err := os.Stat(fixture.app.updates.dir); err == nil {
		t.Errorf("notify mode created %s, want no download", fixture.app.updates.dir)
	}
	if got := fixture.states(); !slices.Equal(got, []string{updateChecking, updateAvailable}) {
		t.Errorf("events = %v, want checking then available", got)
	}
}

func TestCheckDownloadModeEndsReady(t *testing.T) {
	fixture := newUpdateFixture(t, updateDownload, feedOptions{})

	status := fixture.app.CheckForUpdates()

	if status.State != updateReady || status.Version != newVersion {
		t.Fatalf("status = %+v, want ready %s", status, newVersion)
	}
	if got := fixture.states(); !slices.Equal(got, []string{updateChecking, updateAvailable, updateDownloading, updateReady}) {
		t.Errorf("events = %v, want checking, available, downloading, ready", got)
	}
	if _, err := os.Stat(fixture.app.updates.file); err != nil {
		t.Errorf("downloaded file is missing: %v", err)
	}
}

func TestCheckCurrentVersion(t *testing.T) {
	fixture := newUpdateFixture(t, updateNotify, feedOptions{version: "0.0.1"})

	if status := fixture.app.CheckForUpdates(); status.State != updateCurrent {
		t.Errorf("state = %q, want current", status.State)
	}
}

func TestSkippedVersion(t *testing.T) {
	fixture := newUpdateFixture(t, updateNotify, feedOptions{})
	settings := fixture.app.GetSettings()
	settings.Update.Skipped = newVersion
	if err := fixture.app.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings failed: %v", err)
	}

	fixture.app.backgroundCheck(t.Context())
	if got := fixture.app.GetUpdateStatus().State; got != updateIdle {
		t.Errorf("background state = %q, want idle", got)
	}
	if got := fixture.app.CheckForUpdates().State; got != updateAvailable {
		t.Errorf("manual state = %q, want available", got)
	}
}

func TestCheckFailureLogsOnceAndNeverOffersAnUpdate(t *testing.T) {
	fixture := newUpdateFixture(t, updateNotify, feedOptions{status: http.StatusForbidden})

	status := fixture.app.CheckForUpdates()

	if status.State != updateError || status.Error == "" {
		t.Fatalf("status = %+v, want an error", status)
	}
	if slices.Contains(fixture.states(), updateAvailable) {
		t.Errorf("events = %v, want no available", fixture.states())
	}
	if len(fixture.errors) != 1 {
		t.Errorf("logged %d errors, want 1: %v", len(fixture.errors), fixture.errors)
	}
}

func TestOffModeSkipsBackgroundCheck(t *testing.T) {
	fixture := newUpdateFixture(t, updateOff, feedOptions{})

	fixture.app.backgroundCheck(t.Context())

	if hits := fixture.hits.Load(); hits != 0 {
		t.Errorf("feed hit %d times, want 0", hits)
	}
	if got := fixture.app.GetUpdateStatus().State; got != updateIdle {
		t.Errorf("state = %q, want idle", got)
	}
}

func TestCannotInstallWithoutAssetOrChecksums(t *testing.T) {
	for name, feed := range map[string]feedOptions{
		"no asset":     {skipAsset: true},
		"no checksums": {skipSums: true},
	} {
		t.Run(name, func(t *testing.T) {
			fixture := newUpdateFixture(t, updateDownload, feed)

			status := fixture.app.CheckForUpdates()

			if status.State != updateAvailable || status.CanInstall {
				t.Errorf("status = %+v, want available without an Update button and no download", status)
			}
			if err := fixture.app.DownloadUpdate(); err == nil {
				t.Error("DownloadUpdate succeeded, want an error")
			}
		})
	}
}

func TestDownloadUpdate(t *testing.T) {
	fixture := newUpdateFixture(t, updateNotify, feedOptions{})
	if err := fixture.app.DownloadUpdate(); err == nil {
		t.Fatal("DownloadUpdate before any check succeeded, want an error")
	}

	fixture.app.CheckForUpdates()
	if err := fixture.app.DownloadUpdate(); err != nil {
		t.Fatalf("DownloadUpdate failed: %v", err)
	}
	if got := fixture.app.GetUpdateStatus().State; got != updateReady {
		t.Errorf("state = %q, want ready", got)
	}
}

func TestSaveSettingsRoundTripsUpdate(t *testing.T) {
	app := newTestApp(t)
	settings := app.GetSettings()
	settings.Update = UpdateSettings{Mode: updateDownload, Skipped: "1.2.3"}
	if err := app.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings failed: %v", err)
	}

	got, err := readSettings(filepath.Join(app.dataDir, settingsFile))
	if err != nil {
		t.Fatalf("readSettings failed: %v", err)
	}
	if got.Update != settings.Update {
		t.Errorf("update = %+v, want %+v", got.Update, settings.Update)
	}

	settings.Update.Mode = "bogus"
	if err := app.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings failed: %v", err)
	}
	if got := app.GetSettings().Update.Mode; got != updateNotify {
		t.Errorf("unknown mode saved as %q, want notify", got)
	}
}

func TestReadSettingsDefaultsUpdateMode(t *testing.T) {
	for name, content := range map[string]string{
		"no update key":   `{"historyLimit": 20}`,
		"empty mode":      `{"update": {"skipped": "1.0.0"}}`,
		"unknown mode":    `{"update": {"mode": "sometimes"}}`,
		"no file content": `{}`,
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), settingsFile)
			if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
				t.Fatalf("failed to write settings: %v", err)
			}
			settings, err := readSettings(path)
			if err != nil {
				t.Fatalf("readSettings failed: %v", err)
			}
			if settings.Update.Mode != updateNotify {
				t.Errorf("mode = %q, want notify", settings.Update.Mode)
			}
		})
	}
}

func TestSkipUpdate(t *testing.T) {
	fixture := newUpdateFixture(t, updateNotify, feedOptions{})
	fixture.app.CheckForUpdates()

	if err := fixture.app.SkipUpdate(newVersion); err != nil {
		t.Fatalf("SkipUpdate failed: %v", err)
	}

	if got := fixture.app.GetSettings().Update.Skipped; got != newVersion {
		t.Errorf("skipped = %q, want %s", got, newVersion)
	}
	if got := fixture.app.GetUpdateStatus().State; got != updateIdle {
		t.Errorf("state = %q, want idle", got)
	}
}

func TestRestartToUpdateWithoutWindow(t *testing.T) {
	app := newTestApp(t)
	app.ctx = nil

	app.RestartToUpdate()

	if !app.updates.restart {
		t.Error("restart flag not set")
	}
}

func TestInstallUpdateOnShutdown(t *testing.T) {
	tests := []struct {
		name       string
		mode       string
		restart    bool
		wantBinary string
	}{
		{name: "auto mode installs", mode: updateAuto, wantBinary: newBinary},
		{name: "download mode waits for a restart request", mode: updateDownload, wantBinary: oldBinary},
		{name: "notify mode never installs", mode: updateNotify, wantBinary: oldBinary},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := newUpdateFixture(t, test.mode, feedOptions{})
			if test.mode == updateNotify {
				fixture.app.CheckForUpdates()
				if err := fixture.app.DownloadUpdate(); err != nil {
					t.Fatalf("DownloadUpdate failed: %v", err)
				}
			} else if status := fixture.app.CheckForUpdates(); status.State != updateReady {
				t.Fatalf("state = %q, want ready", status.State)
			}

			fixture.app.installUpdate()

			assertFile(t, fixture.exe, test.wantBinary)
		})
	}
}
