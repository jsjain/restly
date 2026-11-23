package update

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func requireOK(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func requireError(t *testing.T, label string, err error) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: expected an error, got nil", label)
	}
}

func TestNewer(t *testing.T) {
	tests := []struct {
		candidate string
		current   string
		want      bool
	}{
		{"0.3.4", "0.3.3", true},
		{"0.10.0", "0.9.9", true},
		{"v1.0.0", "0.3.3", true},
		{"0.3.3", "0.3.3", false},
		{"0.3.2", "0.3.3", false},
		{"0.4.0-beta", "0.3.3", false},
		{"nightly", "0.3.3", false},
		{"0.3.4", "dev", false},
	}
	for _, tt := range tests {
		t.Run(tt.candidate+"_vs_"+tt.current, func(t *testing.T) {
			if got := Newer(tt.candidate, tt.current); got != tt.want {
				t.Errorf("Newer(%q, %q) = %v, want %v", tt.candidate, tt.current, got, tt.want)
			}
		})
	}
}

func TestLatest(t *testing.T) {
	var gotAgent, gotAccept string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/limited" {
			http.Error(w, "rate limited", http.StatusForbidden)
			return
		}
		gotAgent, gotAccept = r.Header.Get("User-Agent"), r.Header.Get("Accept")
		fmt.Fprint(w, `{"tag_name":"v0.3.4","html_url":"https://github.com/jsjain/restly/releases/tag/v0.3.4",`+
			`"assets":[{"name":"SHA256SUMS.txt","browser_download_url":"https://github.com/x/SHA256SUMS.txt"}]}`)
	}))
	defer server.Close()

	release, err := Latest(t.Context(), server.Client(), server.URL+"/latest")
	requireOK(t, err)
	if release.Version != "0.3.4" {
		t.Errorf("Version = %q, want 0.3.4", release.Version)
	}
	if want := "https://github.com/jsjain/restly/releases/tag/v0.3.4"; release.PageURL != want {
		t.Errorf("PageURL = %q, want %q", release.PageURL, want)
	}
	if got := release.Assets["SHA256SUMS.txt"]; got != "https://github.com/x/SHA256SUMS.txt" || len(release.Assets) != 1 {
		t.Errorf("Assets = %v", release.Assets)
	}
	if gotAgent != "Restly-updater" || gotAccept != "application/vnd.github+json" {
		t.Errorf("headers = %q, %q", gotAgent, gotAccept)
	}

	_, err = Latest(t.Context(), server.Client(), server.URL+"/limited")
	requireError(t, "403", err)
	if !strings.Contains(err.Error(), "403") {
		t.Errorf("error %q does not name status 403", err)
	}
}

func TestDetect(t *testing.T) {
	dir := t.TempDir()
	bundleExe := filepath.Join(dir, "Restly.app", "Contents", "MacOS", "restly")
	plainExe := filepath.Join(dir, "restly")
	setupDir := filepath.Join(dir, "setup")
	requireOK(t, os.Mkdir(setupDir, 0o755))
	requireOK(t, os.WriteFile(filepath.Join(setupDir, "uninstall.exe"), nil, 0o644))

	tests := []struct {
		name string
		exe  string
		goos string
		want Target
	}{
		{"darwin bundle", bundleExe, "darwin", Target{KindMacApp, filepath.Join(dir, "Restly.app")}},
		{"darwin outside a bundle", plainExe, "darwin", Target{KindNoticeOnly, plainExe}},
		{"linux under usr", "/usr/bin/restly", "linux", Target{KindNoticeOnly, "/usr/bin/restly"}},
		{"linux tarball", plainExe, "linux", Target{KindLinuxTar, plainExe}},
		{"windows with uninstaller", filepath.Join(setupDir, "Restly.exe"), "windows", Target{KindWindowsSetup, filepath.Join(setupDir, "Restly.exe")}},
		{"windows portable", filepath.Join(dir, "Restly.exe"), "windows", Target{KindWindowsPortable, filepath.Join(dir, "Restly.exe")}},
		{"unwritable folder", filepath.Join(dir, "missing", "restly"), "linux", Target{KindNoticeOnly, filepath.Join(dir, "missing", "restly")}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Detect(tt.exe, tt.goos); got != tt.want {
				t.Errorf("Detect(%q, %q) = %+v, want %+v", tt.exe, tt.goos, got, tt.want)
			}
		})
	}
}

func TestAssetName(t *testing.T) {
	tests := []struct {
		kind Kind
		arch string
		want string
	}{
		{KindMacApp, "arm64", "Restly-1.2.3-macos-apple-silicon.dmg"},
		{KindMacApp, "amd64", "Restly-1.2.3-macos-intel.dmg"},
		{KindWindowsSetup, "amd64", "Restly-1.2.3-windows-amd64-setup.exe"},
		{KindWindowsPortable, "amd64", "Restly-1.2.3-windows-amd64-portable.exe"},
		{KindLinuxTar, "amd64", "Restly-1.2.3-linux-amd64.tar.gz"},
		{KindNoticeOnly, "amd64", ""},
	}
	for _, tt := range tests {
		t.Run(string(tt.kind)+"_"+tt.arch, func(t *testing.T) {
			if got := AssetName(tt.kind, tt.arch, "1.2.3"); got != tt.want {
				t.Errorf("AssetName(%q, %q) = %q, want %q", tt.kind, tt.arch, got, tt.want)
			}
		})
	}
}

func TestDownload(t *testing.T) {
	const name = "Restly-1.2.3-linux-amd64.tar.gz"
	content := []byte("asset bytes")
	digest := sha256.Sum256(content)
	goodSum := hex.EncodeToString(digest[:])

	sums := goodSum + "  " + name + "\n"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sums":
			fmt.Fprint(w, sums)
		case "/asset":
			w.Write(content)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	origin, err := url.Parse(server.URL)
	requireOK(t, err)

	release := func(assets map[string]string) Release { return Release{Version: "1.2.3", Assets: assets} }
	good := map[string]string{name: server.URL + "/asset", "SHA256SUMS.txt": server.URL + "/sums"}

	t.Run("match", func(t *testing.T) {
		dir := t.TempDir()
		path, err := Download(t.Context(), server.Client(), release(good), name, dir, origin)
		requireOK(t, err)
		got, err := os.ReadFile(path)
		requireOK(t, err)
		if string(got) != string(content) || path != filepath.Join(dir, name) {
			t.Errorf("path %q holds %q", path, got)
		}
	})

	failures := []struct {
		name   string
		assets map[string]string
		sums   string
	}{
		{"wrong checksum", good, strings.Repeat("0", 64) + "  " + name + "\n"},
		{"asset missing from sums", good, goodSum + "  other.tar.gz\n"},
		{"asset missing from release", map[string]string{"SHA256SUMS.txt": server.URL + "/sums"}, sums},
		{"sums missing from release", map[string]string{name: server.URL + "/asset"}, sums},
		{"asset on another host", map[string]string{name: "http://example.invalid/asset", "SHA256SUMS.txt": server.URL + "/sums"}, sums},
		{"asset not found", map[string]string{name: server.URL + "/nope", "SHA256SUMS.txt": server.URL + "/sums"}, sums},
	}
	for _, tt := range failures {
		t.Run(tt.name, func(t *testing.T) {
			sums = tt.sums
			dir := t.TempDir()
			_, err := Download(t.Context(), server.Client(), release(tt.assets), name, dir, origin)
			requireError(t, tt.name, err)
			entries, readErr := os.ReadDir(dir)
			requireOK(t, readErr)
			if len(entries) != 0 {
				t.Errorf("left %d files in the download folder", len(entries))
			}
		})
	}
}

func TestInstallNoticeOnlyFails(t *testing.T) {
	err := Install(t.Context(), Target{Kind: KindNoticeOnly, Path: "/usr/bin/restly"}, "", false)
	requireError(t, "notice only", err)
}

func TestWindowsSetupCmdLine(t *testing.T) {
	setup := `C:\Users\Jo Doe\updates\Restly-1.2.3-windows-amd64-setup.exe`
	exe := `C:\Program Files\Restly\Restly.exe`

	withRelaunch := windowsSetupCmdLine(setup, exe, true)
	wantRelaunch := `cmd /c "ping -n 3 127.0.0.1 >nul & start /wait "" "` + setup + `" /S /D=C:\Program Files\Restly & start "" "` + exe + `""`
	if withRelaunch != wantRelaunch {
		t.Errorf("with relaunch:\n got %s\nwant %s", withRelaunch, wantRelaunch)
	}
	if without := windowsSetupCmdLine(setup, exe, false); strings.Contains(without, exe) {
		t.Errorf("without relaunch still starts Restly: %s", without)
	}
}
