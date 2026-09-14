package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"restly/internal/collection"
	"restly/internal/curl"
	"restly/internal/history"
	"restly/internal/httpx"
	"restly/internal/runner"
	"restly/internal/script"
	"restly/internal/snippet"
	"restly/internal/vars"
	"restly/internal/ws"
)

// App is bound to the webview. Every exported method is callable from the frontend.
type App struct {
	ctx      context.Context
	dir      string // workspace folder
	dataDir  string // settings, cookies, and history, kept out of the workspace because they hold secrets
	client   *httpx.Client
	sockets  *ws.Manager
	history  *history.Store // nil until the data folder opens
	unsaved  atomic.Bool    // the webview has edits that quitting would lose
	quitting atomic.Bool    // the user confirmed quitting in the webview
	emit     func(event string, data any)
	logError func(format string, args ...any)

	mu           sync.Mutex // guards the fields below
	collections  map[string]*collection.Collection
	environments map[string]*collection.Environment
	globals      *collection.Environment
	settings     Settings
	stopRun      context.CancelFunc // nil when no run is active
	lastBody     []byte
}

func NewApp() *App {
	app := &App{
		collections:  map[string]*collection.Collection{},
		environments: map[string]*collection.Environment{},
		settings:     Settings{Network: httpx.DefaultNetwork()},
		emit:         func(string, any) {},
		logError:     log.Printf,
	}
	app.sockets = ws.NewManager(func(event ws.Event) { app.emit(eventWebSocket, event) })
	return app
}

func (app *App) startup(ctx context.Context) {
	app.ctx = ctx
	app.emit = func(event string, data any) { runtime.EventsEmit(ctx, event, data) }
	app.logError = func(format string, args ...any) { runtime.LogErrorf(ctx, format, args...) }
	if err := app.openWorkspace(); err != nil {
		app.logError("failed to open workspace: %v", err)
		return
	}
	configDir, err := os.UserConfigDir()
	if err != nil {
		app.logError("failed to find the settings folder: %v", err)
		return
	}
	if err := app.openData(filepath.Join(configDir, "Restly")); err != nil {
		app.logError("failed to load settings, cookies, or history: %v", err)
	}
}

func (app *App) openWorkspace() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to find home folder: %w", err)
	}
	dir := filepath.Join(home, "Restly")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("failed to create workspace %s: %w", dir, err)
	}
	globals, err := collection.LoadEnvironment(filepath.Join(dir, globalsFile))
	if errors.Is(err, fs.ErrNotExist) {
		globals, err = &collection.Environment{Name: "Globals", Scope: "globals"}, nil
	}
	if err != nil {
		return err
	}
	app.dir, app.client, app.globals = dir, httpx.NewClient(dir), globals
	return nil
}

// openData loads settings, cookies, and history from dir and applies the network settings.
// One failure does not stop the others, so a bad certificate path still leaves history usable.
func (app *App) openData(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("failed to create data folder %s: %w", dir, err)
	}
	app.dataDir = dir
	var errs []error
	settings, err := readSettings(filepath.Join(dir, settingsFile))
	if err != nil {
		errs = append(errs, err)
	}
	app.mu.Lock()
	app.settings = settings
	app.mu.Unlock()
	if err := app.client.Configure(settings.Network); err != nil {
		errs = append(errs, fmt.Errorf("failed to apply network settings: %w", err))
	}
	if err := app.client.Jar().Load(filepath.Join(dir, cookiesFile)); err != nil {
		errs = append(errs, fmt.Errorf("failed to load cookies: %w", err))
	}
	store, err := history.Open(filepath.Join(dir, historyFile), historyLimit)
	if err != nil {
		errs = append(errs, fmt.Errorf("failed to load history: %w", err))
	}
	app.history = store
	return errors.Join(errs...)
}

func (app *App) shutdown(ctx context.Context) {
	app.sockets.CloseAll()
	if err := app.saveCookies(); err != nil {
		app.logError("%v", err)
	}
}

// beforeClose hands a quit with unsaved edits to the webview, which asks and then calls QuitApp.
// Wails routes the window close button, Cmd+Q, and runtime.Quit here.
func (app *App) beforeClose(ctx context.Context) (prevent bool) {
	if !app.unsaved.Load() || app.quitting.Load() {
		return false
	}
	app.emit(eventQuitRequest, nil)
	return true
}

// QuitApp quits after the user confirmed losing unsaved edits.
func (app *App) QuitApp() {
	app.quitting.Store(true)
	runtime.Quit(app.ctx)
}

// SetUnsaved tells the app whether quitting now would lose edits.
func (app *App) SetUnsaved(unsaved bool) {
	app.unsaved.Store(unsaved)
}

// GetAppInfo returns the version, commit, build time, and Go version shown in Settings > About.
func (app *App) GetAppInfo() AppInfo {
	info, err := buildAppInfo()
	if err != nil {
		app.logError("failed to read app info: %v", err)
	}
	return info
}

func (app *App) GetSettings() Settings {
	app.mu.Lock()
	defer app.mu.Unlock()
	return app.settings
}

// SaveSettings applies the settings before saving them, so a bad certificate path is reported and nothing is saved.
func (app *App) SaveSettings(settings Settings) error {
	if app.dataDir == "" {
		return errors.New("settings folder failed to open, see the log for details")
	}
	if err := app.client.Configure(settings.Network); err != nil {
		return err
	}
	data, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("failed to encode settings: %w", err)
	}
	if err := collection.WriteJSON(filepath.Join(app.dataDir, settingsFile), json.RawMessage(data)); err != nil {
		return err
	}
	app.mu.Lock()
	app.settings = settings
	app.mu.Unlock()
	return nil
}

// PickFile shows a native file picker and returns the chosen path, or "" when cancelled.
func (app *App) PickFile(title string) (string, error) {
	path, err := runtime.OpenFileDialog(app.ctx, runtime.OpenDialogOptions{Title: title})
	if err != nil {
		return "", fmt.Errorf("failed to show file dialog: %w", err)
	}
	return path, nil
}

// ListThemes returns the imported VS Code color themes as text. The webview converts them,
// so a broken file skips only that theme.
func (app *App) ListThemes() ([]TextFile, error) {
	if app.dataDir == "" {
		return []TextFile{}, nil
	}
	dir := filepath.Join(app.dataDir, themesDir)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return []TextFile{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to list themes in %s: %w", dir, err)
	}
	themes := []TextFile{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		file := filepath.Join(dir, entry.Name())
		data, err := os.ReadFile(file)
		if err != nil {
			return nil, fmt.Errorf("failed to read theme %s: %w", file, err)
		}
		themes = append(themes, TextFile{File: file, Data: string(data)})
	}
	return themes, nil
}

// ImportTheme copies a VS Code color theme picked in a file dialog into the themes folder.
// It returns nil when the dialog is cancelled.
func (app *App) ImportTheme() (*TextFile, error) {
	path, err := runtime.OpenFileDialog(app.ctx, runtime.OpenDialogOptions{
		Title:   "Import a VS Code color theme",
		Filters: []runtime.FileFilter{{DisplayName: "VS Code color theme (*.json)", Pattern: "*.json"}},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to show file dialog: %w", err)
	}
	if path == "" {
		return nil, nil
	}
	return app.importTheme(path)
}

// importTheme keeps the file name, so importing an updated copy of a theme replaces the old one.
func (app *App) importTheme(path string) (*TextFile, error) {
	if app.dataDir == "" {
		return nil, errors.New("settings folder failed to open, see the log for details")
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read theme %s: %w", path, err)
	}
	if info.Size() > maxThemeSize {
		return nil, fmt.Errorf("%s is larger than 5 MB, which is too big for a color theme", filepath.Base(path))
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read theme %s: %w", path, err)
	}
	dir := filepath.Join(app.dataDir, themesDir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("failed to create themes folder %s: %w", dir, err)
	}
	target := filepath.Join(dir, filepath.Base(path))
	if filepath.Ext(target) != ".json" {
		target += ".json"
	}
	if err := os.WriteFile(target, data, 0o600); err != nil {
		return nil, fmt.Errorf("failed to save theme %s: %w", target, err)
	}
	return &TextFile{File: target, Data: string(data)}, nil
}

// DeleteTheme removes an imported theme. Only files directly inside the themes folder qualify.
func (app *App) DeleteTheme(file string) error {
	dir := filepath.Join(app.dataDir, themesDir)
	if app.dataDir == "" || filepath.Dir(filepath.Clean(file)) != dir {
		return fmt.Errorf("%s is not an imported theme", file)
	}
	if err := os.Remove(file); err != nil {
		return fmt.Errorf("failed to delete theme %s: %w", file, err)
	}
	return nil
}

// GetKeybindings returns keybindings.json, first writing a commented template so there is a file to edit.
func (app *App) GetKeybindings() (*TextFile, error) {
	if app.dataDir == "" {
		return nil, errors.New("settings folder failed to open, see the log for details")
	}
	file := filepath.Join(app.dataDir, keybindingsFile)
	data, err := os.ReadFile(file)
	if errors.Is(err, fs.ErrNotExist) {
		data = []byte(keybindingsTemplate)
		if err := os.WriteFile(file, data, 0o600); err != nil {
			return nil, fmt.Errorf("failed to create %s: %w", file, err)
		}
	} else if err != nil {
		return nil, fmt.Errorf("failed to read %s: %w", file, err)
	}
	return &TextFile{File: file, Data: string(data)}, nil
}

// OpenKeybindings opens keybindings.json in the system text editor.
func (app *App) OpenKeybindings() error {
	keybindings, err := app.GetKeybindings()
	if err != nil {
		return err
	}
	return openInTextEditor(keybindings.File)
}

func (app *App) ListCookies() []httpx.Cookie {
	return app.client.Jar().List()
}

func (app *App) SaveCookie(cookie httpx.Cookie) error {
	if err := app.client.Jar().Put(cookie); err != nil {
		return err
	}
	return app.saveCookies()
}

func (app *App) DeleteCookie(domain, path, name string) error {
	app.client.Jar().Delete(domain, path, name)
	return app.saveCookies()
}

func (app *App) ClearCookies() error {
	app.client.Jar().Clear()
	return app.saveCookies()
}

// saveCookies writes the jar. Cookies set by responses are written here and at shutdown, so a crash loses the newest ones.
func (app *App) saveCookies() error {
	if app.dataDir == "" {
		return nil
	}
	if err := app.client.Jar().Save(filepath.Join(app.dataDir, cookiesFile)); err != nil {
		return fmt.Errorf("failed to save cookies: %w", err)
	}
	return nil
}

func (app *App) GetHistory() []history.Entry {
	if app.history == nil {
		return []history.Entry{}
	}
	return app.history.List()
}

func (app *App) DeleteHistory(id string) error {
	if app.history == nil {
		return nil
	}
	return app.history.Delete(id)
}

func (app *App) ClearHistory() error {
	if app.history == nil {
		return nil
	}
	return app.history.Clear()
}

// recordHistory saves entry and tells the webview. A failed write only costs that entry, so it is logged.
func (app *App) recordHistory(entry history.Entry) {
	if app.history == nil {
		return
	}
	added, err := app.history.Add(entry)
	if err != nil {
		app.logError("failed to save history entry for %s: %v", entry.URL, err)
		return
	}
	app.emit(eventHistoryAdded, added)
}

// WSConnect opens a WebSocket connection under id. The webview chooses id, so events that arrive
// during the handshake already know their tab.
func (app *App) WSConnect(id string, input SendInput) error {
	if input.Item == nil || input.Item.Request == nil {
		return errors.New("select a WebSocket request to connect")
	}
	tgt, err := app.target(input.File, input.Env)
	if err != nil {
		return err
	}
	ancestors, err := ancestorsOf(tgt.coll, input.Path)
	if err != nil {
		return err
	}
	auth := runner.EffectiveAuth(tgt.coll, ancestors, input.Item.Request)
	prep, err := httpx.Resolve(input.Item.Request, auth, tgt.scope)
	if err != nil {
		return err
	}
	header := http.Header{}
	for _, field := range prep.Header {
		header.Add(field.Key, field.Value)
	}
	err = app.sockets.Connect(app.ctx, id, prep.URL, header, app.client.DialSettings)
	entry := history.Entry{
		Time:   time.Now().UnixMilli(),
		Method: "WS",
		URL:    prep.URL,
		Item:   input.Item,
	}
	if err != nil {
		entry.Error = err.Error()
	}
	app.recordHistory(entry)
	return err
}

func (app *App) WSSend(id, message string) error {
	return app.sockets.Send(id, message)
}

func (app *App) WSClose(id string) error {
	return app.sockets.Close(id)
}

// GetWorkspace lists the collection and environment files in the workspace folder.
func (app *App) GetWorkspace() (*Workspace, error) {
	if app.client == nil {
		return nil, errors.New("workspace failed to open, see the log for details")
	}
	entries, err := os.ReadDir(app.dir)
	if err != nil {
		return nil, fmt.Errorf("failed to list workspace %s: %w", app.dir, err)
	}
	workspace := &Workspace{
		Dir:          app.dir,
		Collections:  []FileRef{},
		Environments: []FileRef{},
		Globals:      app.globalsPath(),
	}
	for _, dirEntry := range entries {
		name := dirEntry.Name()
		file := filepath.Join(app.dir, name)
		switch {
		case strings.HasSuffix(name, collectionExt):
			workspace.Collections = append(workspace.Collections, FileRef{File: file, Name: readName(file, collectionExt)})
		case strings.HasSuffix(name, environmentExt):
			ref := FileRef{File: file, Name: readName(file, environmentExt)}
			if owner := readOwner(file); owner != "" {
				ref.Collection = filepath.Join(app.dir, owner)
			}
			workspace.Environments = append(workspace.Environments, ref)
		}
	}
	byName := func(a, b FileRef) int { return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)) }
	slices.SortFunc(workspace.Collections, byName)
	slices.SortFunc(workspace.Environments, byName)
	return workspace, nil
}

// OpenCollection returns the collection file's JSON as stored. The webview only needs the JSON,
// and decoding then re-encoding through the Go model costs about 300 ms for a 5 MB collection.
func (app *App) OpenCollection(file string) (json.RawMessage, error) {
	file, err := app.workspaceFile(file)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read collection: %w", err)
	}
	if collection.DetectKind(data) != collection.KindCollection {
		return nil, fmt.Errorf("%s is not a Postman v2 collection", filepath.Base(file))
	}
	app.forgetCollection(file)
	return data, nil
}

// SaveCollection writes the webview's collection JSON as sent. The webview keeps every member
// it does not edit, so the file stays lossless and keeps its key order.
func (app *App) SaveCollection(file string, data json.RawMessage) error {
	file, err := app.workspaceFile(file)
	if err != nil {
		return err
	}
	if collection.DetectKind(data) != collection.KindCollection {
		return fmt.Errorf("refusing to save %s: the data is not a Postman collection", filepath.Base(file))
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	if err := collection.WriteJSON(file, data); err != nil {
		return err
	}
	// The next send or run decodes the saved file.
	delete(app.collections, file)
	return nil
}

func (app *App) forgetCollection(file string) {
	app.mu.Lock()
	delete(app.collections, file)
	app.mu.Unlock()
}

func (app *App) saveTypedCollection(file string, coll *collection.Collection) error {
	app.mu.Lock()
	defer app.mu.Unlock()
	if err := collection.SaveCollection(file, coll); err != nil {
		return err
	}
	app.collections[file] = coll
	return nil
}

func (app *App) NewCollection(name string) (*FileRef, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("collection name is empty")
	}
	coll := &collection.Collection{Info: collection.Info{PostmanID: vars.UUID(), Name: name}}
	file := app.freeFile(name, collectionExt)
	if err := app.saveTypedCollection(file, coll); err != nil {
		return nil, err
	}
	return &FileRef{File: file, Name: name}, nil
}

// DuplicateCollection copies a saved collection to a new file named "<name> Copy". The copy gets a
// new _postman_id, so importing both into Postman keeps them apart.
func (app *App) DuplicateCollection(file string) (*FileRef, error) {
	file, err := app.workspaceFile(file)
	if err != nil {
		return nil, err
	}
	coll, err := collection.LoadCollection(file)
	if err != nil {
		return nil, err
	}
	coll.Info.Name += " Copy"
	coll.Info.PostmanID = vars.UUID()
	target := app.freeFile(coll.Info.Name, collectionExt)
	if err := app.saveTypedCollection(target, coll); err != nil {
		return nil, err
	}
	return &FileRef{File: target, Name: coll.Info.Name}, nil
}

func (app *App) OpenEnvironment(file string) (*collection.Environment, error) {
	file, err := app.workspaceFile(file)
	if err != nil {
		return nil, err
	}
	if file == app.globalsPath() {
		// The globals file does not exist until something sets a global.
		app.mu.Lock()
		defer app.mu.Unlock()
		return app.globals, nil
	}
	env, err := collection.LoadEnvironment(file)
	if err != nil {
		return nil, err
	}
	app.mu.Lock()
	app.environments[file] = env
	app.mu.Unlock()
	return env, nil
}

func (app *App) SaveEnvironment(file string, env *collection.Environment) error {
	file, err := app.workspaceFile(file)
	if err != nil {
		return err
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	if err := collection.SaveEnvironment(file, env); err != nil {
		return err
	}
	if file == app.globalsPath() {
		// Scripts read and write globals through app.globals, not the environment cache.
		app.globals = env
		return nil
	}
	app.environments[file] = env
	return nil
}

// NewEnvironment creates an environment owned by collFile, or a shared one when collFile is "".
func (app *App) NewEnvironment(name, collFile string) (*FileRef, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("environment name is empty")
	}
	env := &collection.Environment{
		ID:     vars.UUID(),
		Name:   name,
		Scope:  "environment",
		Values: []collection.EnvValue{},
	}
	ref := &FileRef{Name: name}
	if collFile != "" {
		resolved, err := app.workspaceFile(collFile)
		if err != nil {
			return nil, err
		}
		env.Collection = filepath.Base(resolved)
		// Same form GetWorkspace reports, so the webview can compare paths.
		ref.Collection = filepath.Join(app.dir, env.Collection)
	}
	ref.File = app.freeFile(name, environmentExt)
	if err := app.SaveEnvironment(ref.File, env); err != nil {
		return nil, err
	}
	return ref, nil
}

// DeleteFile removes a workspace file. The webview asks for confirmation first.
func (app *App) DeleteFile(file string) error {
	file, err := app.workspaceFile(file)
	if err != nil {
		return err
	}
	if err := os.Remove(file); err != nil {
		return fmt.Errorf("failed to delete %s: %w", file, err)
	}
	app.mu.Lock()
	delete(app.collections, file)
	delete(app.environments, file)
	app.mu.Unlock()
	return nil
}

// Import opens a native file picker and copies Postman collection and environment files into the workspace.
func (app *App) Import() ([]FileRef, error) {
	paths, err := runtime.OpenMultipleFilesDialog(app.ctx, runtime.OpenDialogOptions{
		Title:   "Import Postman collections and environments",
		Filters: []runtime.FileFilter{{DisplayName: "Postman JSON (*.json)", Pattern: "*.json"}},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to show import dialog: %w", err)
	}
	refs := []FileRef{}
	var errs []error
	for _, path := range paths {
		ref, err := app.importFile(path)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		refs = append(refs, *ref)
	}
	return refs, errors.Join(errs...)
}

func (app *App) importFile(path string) (*FileRef, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read %s: %w", path, err)
	}
	switch collection.DetectKind(data) {
	case collection.KindCollection:
		coll, err := collection.LoadCollection(path)
		if err != nil {
			return nil, err
		}
		file := app.freeFile(coll.Info.Name, collectionExt)
		if err := app.saveTypedCollection(file, coll); err != nil {
			return nil, err
		}
		return &FileRef{File: file, Name: coll.Info.Name}, nil
	case collection.KindEnvironment:
		env, err := collection.LoadEnvironment(path)
		if err != nil {
			return nil, err
		}
		file := app.freeFile(env.Name, environmentExt)
		if err := app.SaveEnvironment(file, env); err != nil {
			return nil, err
		}
		return &FileRef{File: file, Name: env.Name}, nil
	}
	return nil, fmt.Errorf("%s is not a Postman v2 collection or environment", filepath.Base(path))
}

// Export copies the saved file to a path chosen in a native save dialog. It returns "" when the user cancels.
// Workspace files are already in Postman's format, so no conversion is needed.
func (app *App) Export(file string) (string, error) {
	file, err := app.workspaceFile(file)
	if err != nil {
		return "", err
	}
	target, err := runtime.SaveFileDialog(app.ctx, runtime.SaveDialogOptions{
		Title:           "Export",
		DefaultFilename: filepath.Base(file),
	})
	if err != nil {
		return "", fmt.Errorf("failed to show export dialog: %w", err)
	}
	if target == "" {
		return "", nil
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return "", fmt.Errorf("failed to read %s: %w", file, err)
	}
	if err := os.WriteFile(target, data, 0o644); err != nil {
		return "", fmt.Errorf("failed to export to %s: %w", target, err)
	}
	return target, nil
}

// Send runs the pre-request scripts, sends the request, and runs the test scripts.
// Variable changes made by scripts are saved to disk and returned.
func (app *App) Send(input SendInput) (*SendResult, error) {
	if input.Item == nil || input.Item.Request == nil {
		return nil, errors.New("select a request to send")
	}
	tgt, err := app.target(input.File, input.Env)
	if err != nil {
		return nil, err
	}
	ancestors, err := ancestorsOf(tgt.coll, input.Path)
	if err != nil {
		return nil, err
	}
	before := snapshot(tgt.scope)
	outcome := runner.Exec(app.ctx, app.client, tgt.scope, runner.Step{
		Collection: tgt.coll,
		Ancestors:  ancestors,
		Item:       input.Item,
		Info:       script.Info{RequestName: input.Item.Name, IterationCount: 1},
	})

	result := &SendResult{
		Response: outcome.Response,
		Tests:    outcome.Tests,
		Console:  outcome.Console,
	}
	switch {
	case outcome.Err != nil:
		result.Error = outcome.Err.Error()
	case outcome.Skipped:
		result.Error = "request skipped by pre-request script"
	}
	if outcome.Response != nil {
		app.setBody(result, outcome.Response.Body)
	}
	if err := app.persistScope(tgt, before); err != nil {
		result.Error = strings.TrimSpace(result.Error + "\n" + err.Error())
	}
	app.mu.Lock()
	if coll := app.collections[tgt.collFile]; coll != nil {
		result.Variables = coll.Variable
	}
	if tgt.envFile != "" {
		result.Environment = app.environments[tgt.envFile]
	}
	app.mu.Unlock()
	app.recordHistory(historyEntry(input.Item, outcome, result.Error))
	return result, nil
}

// Snippet generates code for the request with variables substituted. Scripts do not run.
func (app *App) Snippet(input SendInput, lang string) (string, error) {
	if input.Item == nil || input.Item.Request == nil {
		return "", errors.New("select a request")
	}
	tgt, err := app.target(input.File, input.Env)
	if err != nil {
		return "", err
	}
	ancestors, err := ancestorsOf(tgt.coll, input.Path)
	if err != nil {
		return "", err
	}
	auth := runner.EffectiveAuth(tgt.coll, ancestors, input.Item.Request)
	prep, err := httpx.Resolve(input.Item.Request, auth, tgt.scope)
	if err != nil {
		return "", err
	}
	return snippet.Generate(lang, prep)
}

func (app *App) SnippetLangs() []string {
	return snippet.Langs
}

// ParseCurl converts a pasted cURL command into a request item.
func (app *App) ParseCurl(command string) (*collection.Item, error) {
	return curl.Parse(command)
}

// Run starts a collection run on the saved collection and returns at once. Progress arrives
// as "run:result" events and the end as one "run:done" event.
func (app *App) Run(input RunInput) error {
	tgt, err := app.target(input.File, input.Env)
	if err != nil {
		return err
	}
	app.mu.Lock()
	if app.stopRun != nil {
		app.mu.Unlock()
		return errors.New("a run is already in progress")
	}
	ctx, cancel := context.WithCancel(app.ctx)
	app.stopRun = cancel
	app.mu.Unlock()

	before := snapshot(tgt.scope)
	opts := runner.Options{
		Iterations: input.Iterations,
		Delay:      time.Duration(input.DelayMs) * time.Millisecond,
	}
	go func() {
		defer cancel()
		summary := runner.Run(ctx, app.client, tgt.scope, tgt.coll, input.Path, opts, func(result runner.Result) {
			runtime.EventsEmit(app.ctx, eventRunResult, result)
		})
		if err := app.persistScope(tgt, before); err != nil {
			runtime.LogErrorf(app.ctx, "failed to save variables after running %s: %v", tgt.collFile, err)
		}
		app.mu.Lock()
		app.stopRun = nil
		app.mu.Unlock()
		runtime.EventsEmit(app.ctx, eventRunDone, summary)
	}()
	return nil
}

func (app *App) StopRun() {
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.stopRun != nil {
		app.stopRun()
	}
}

// SaveLastBody writes the full body of the last response to a path chosen in a native save dialog.
func (app *App) SaveLastBody() (string, error) {
	target, err := runtime.SaveFileDialog(app.ctx, runtime.SaveDialogOptions{
		Title:           "Save response body",
		DefaultFilename: "response.bin",
	})
	if err != nil {
		return "", fmt.Errorf("failed to show save dialog: %w", err)
	}
	if target == "" {
		return "", nil
	}
	app.mu.Lock()
	body := app.lastBody
	app.mu.Unlock()
	if err := os.WriteFile(target, body, 0o644); err != nil {
		return "", fmt.Errorf("failed to save response body to %s: %w", target, err)
	}
	return target, nil
}

// target loads the collection and environment a request runs against and builds its variable scope.
// An empty collFile is a standalone request, which sees only the environment and globals.
func (app *App) target(collFile, envFile string) (*target, error) {
	tgt := &target{coll: &collection.Collection{}}
	var err error
	if collFile != "" {
		if tgt.collFile, err = app.workspaceFile(collFile); err != nil {
			return nil, err
		}
		if tgt.coll, err = app.cachedCollection(tgt.collFile); err != nil {
			return nil, err
		}
	}
	if envFile != "" {
		if tgt.envFile, err = app.workspaceFile(envFile); err != nil {
			return nil, err
		}
		if tgt.env, err = app.cachedEnvironment(tgt.envFile); err != nil {
			return nil, err
		}
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	tgt.scope = vars.New()
	tgt.scope.Collection = collection.VarMap(tgt.coll.Variable)
	tgt.scope.Globals = collection.EnvMap(app.globals.Values)
	if tgt.env != nil {
		tgt.scope.Environment = collection.EnvMap(tgt.env.Values)
	}
	return tgt, nil
}

func (app *App) cachedCollection(file string) (*collection.Collection, error) {
	app.mu.Lock()
	defer app.mu.Unlock()
	if coll := app.collections[file]; coll != nil {
		return coll, nil
	}
	coll, err := collection.LoadCollection(file)
	if err != nil {
		return nil, err
	}
	app.collections[file] = coll
	return coll, nil
}

func (app *App) cachedEnvironment(file string) (*collection.Environment, error) {
	app.mu.Lock()
	env := app.environments[file]
	app.mu.Unlock()
	if env != nil {
		return env, nil
	}
	return app.OpenEnvironment(file)
}

// persistScope saves the variable changes scripts made, the way Postman keeps current values.
// Only the changed keys are applied, to the cached copies, which may be newer than the ones the request started from.
func (app *App) persistScope(tgt *target, before *vars.Scope) error {
	app.mu.Lock()
	defer app.mu.Unlock()
	var errs []error
	if coll := app.collections[tgt.collFile]; coll != nil && !maps.Equal(before.Collection, tgt.scope.Collection) {
		values := applyChanges(collection.VarMap(coll.Variable), before.Collection, tgt.scope.Collection)
		coll.Variable = collection.SetVars(coll.Variable, values)
		errs = append(errs, collection.SaveCollection(tgt.collFile, coll))
	}
	if env := app.environments[tgt.envFile]; env != nil && !maps.Equal(before.Environment, tgt.scope.Environment) {
		values := applyChanges(collection.EnvMap(env.Values), before.Environment, tgt.scope.Environment)
		env.Values = collection.SetEnv(env.Values, values)
		errs = append(errs, collection.SaveEnvironment(tgt.envFile, env))
	}
	if !maps.Equal(before.Globals, tgt.scope.Globals) {
		values := applyChanges(collection.EnvMap(app.globals.Values), before.Globals, tgt.scope.Globals)
		app.globals.Values = collection.SetEnv(app.globals.Values, values)
		errs = append(errs, collection.SaveEnvironment(filepath.Join(app.dir, globalsFile), app.globals))
	}
	return errors.Join(errs...)
}

func (app *App) setBody(result *SendResult, body []byte) {
	app.mu.Lock()
	app.lastBody = body
	app.mu.Unlock()
	if !utf8.Valid(body) {
		result.Binary = true
		return
	}
	if len(body) > maxBodyView {
		result.Truncated = true
		body = body[:maxBodyView]
	}
	// The cut can split a multi-byte character.
	result.Body = strings.ToValidUTF8(string(body), "")
}

// workspaceFile rejects paths outside the workspace, so the webview can only touch Restly's own files.
func (app *App) workspaceFile(file string) (string, error) {
	abs, err := filepath.Abs(file)
	if err != nil {
		return "", fmt.Errorf("failed to resolve path %s: %w", file, err)
	}
	if app.dir == "" || filepath.Dir(abs) != app.dir {
		return "", fmt.Errorf("%s is not in the workspace", file)
	}
	return abs, nil
}

var unsafeFileChars = regexp.MustCompile(`[^A-Za-z0-9._ -]+`)

// freeFile returns an unused workspace path for name.
func (app *App) freeFile(name, ext string) string {
	base := strings.TrimSpace(unsafeFileChars.ReplaceAllString(name, "_"))
	if base == "" {
		base = "untitled"
	}
	file := filepath.Join(app.dir, base+ext)
	for n := 2; fileExists(file); n++ {
		file = filepath.Join(app.dir, fmt.Sprintf("%s-%d%s", base, n, ext))
	}
	return file
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// readName returns info.name of a collection or name of an environment, falling back to the file name.
func readName(file, ext string) string {
	fallback := strings.TrimSuffix(filepath.Base(file), ext)
	data, err := os.ReadFile(file)
	if err != nil {
		return fallback
	}
	var probe struct {
		Name string `json:"name"`
		Info struct {
			Name string `json:"name"`
		} `json:"info"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		return fallback
	}
	return cmpOr(probe.Info.Name, probe.Name, fallback)
}

// readOwner returns the collection file name an environment belongs to, "" for a shared or unreadable one.
func readOwner(file string) string {
	data, err := os.ReadFile(file)
	if err != nil {
		return ""
	}
	var probe struct {
		Collection string `json:"x-restly-collection"`
	}
	if err := json.Unmarshal(data, &probe); err != nil || probe.Collection == "" {
		return ""
	}
	// A path separator would point outside the workspace.
	return filepath.Base(probe.Collection)
}

func cmpOr(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// ancestorsOf finds the folders above path. Only the parent must be saved, so a new unsaved request can still be sent.
func ancestorsOf(coll *collection.Collection, path []int) ([]*collection.Item, error) {
	if len(path) <= 1 {
		return nil, nil
	}
	parent, grandparents, err := coll.At(path[:len(path)-1])
	if err != nil {
		return nil, fmt.Errorf("failed to find the request's folder, save the collection first: %w", err)
	}
	return append(slices.Clip(grandparents), parent), nil
}

func snapshot(scope *vars.Scope) *vars.Scope {
	return &vars.Scope{
		Environment: maps.Clone(scope.Environment),
		Collection:  maps.Clone(scope.Collection),
		Globals:     maps.Clone(scope.Globals),
	}
}

// applyChanges applies the keys that changed from before to after onto current.
func applyChanges(current, before, after map[string]string) map[string]string {
	for key, value := range after {
		if old, ok := before[key]; !ok || old != value {
			current[key] = value
		}
	}
	for key := range before {
		if _, ok := after[key]; !ok {
			delete(current, key)
		}
	}
	return current
}

func (app *App) globalsPath() string {
	return filepath.Join(app.dir, globalsFile)
}

// readSettings returns the defaults when the file does not exist yet.
func readSettings(path string) (Settings, error) {
	settings := Settings{Network: httpx.DefaultNetwork()}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return settings, nil
	}
	if err != nil {
		return settings, fmt.Errorf("failed to read settings: %w", err)
	}
	if err := json.Unmarshal(data, &settings); err != nil {
		return Settings{Network: httpx.DefaultNetwork()}, fmt.Errorf("failed to parse %s: %w", path, err)
	}
	return settings, nil
}

func historyEntry(item *collection.Item, outcome *runner.Outcome, errText string) history.Entry {
	entry := history.Entry{
		Time:   time.Now().UnixMilli(),
		Method: item.Request.Method,
		Error:  errText,
		Item:   item,
	}
	if outcome.Prepared != nil {
		entry.Method, entry.URL = outcome.Prepared.Method, outcome.Prepared.URL
	}
	if outcome.Response != nil {
		entry.Code = outcome.Response.Code
		entry.DurationMs = outcome.Response.Timings.Total
		entry.Size = outcome.Response.Size
	}
	return entry
}
