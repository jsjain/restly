package update

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func writeTarGz(t *testing.T, dst, entryName, content string) {
	t.Helper()
	out, err := os.Create(dst)
	requireOK(t, err)
	defer out.Close()
	zw := gzip.NewWriter(out)
	tw := tar.NewWriter(zw)
	requireOK(t, tw.WriteHeader(&tar.Header{Name: entryName, Mode: 0o644, Size: int64(len(content)), Typeflag: tar.TypeReg}))
	_, err = tw.Write([]byte(content))
	requireOK(t, err)
	requireOK(t, tw.Close())
	requireOK(t, zw.Close())
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	requireOK(t, err)
	return string(data)
}

func assertExists(t *testing.T, path string, want bool) {
	t.Helper()
	_, err := os.Stat(path)
	if got := err == nil; got != want {
		t.Errorf("%s exists = %v, want %v", path, got, want)
	}
}

func TestInstallSwap(t *testing.T) {
	t.Run("linux tarball", func(t *testing.T) {
		dir := t.TempDir()
		exe := filepath.Join(dir, "restly")
		requireOK(t, os.WriteFile(exe, []byte("old"), 0o755))
		archive := filepath.Join(dir, "restly.tar.gz")
		writeTarGz(t, archive, "./restly", "new")

		requireOK(t, Install(t.Context(), Target{Kind: KindLinuxTar, Path: exe}, archive, false))

		if got := readFile(t, exe); got != "new" {
			t.Errorf("exe holds %q, want new", got)
		}
		info, err := os.Stat(exe)
		requireOK(t, err)
		if info.Mode().Perm() != 0o755 {
			t.Errorf("mode = %v, want 0755", info.Mode().Perm())
		}
		if got := readFile(t, exe+".old"); got != "old" {
			t.Errorf(".old holds %q, want old", got)
		}
		assertExists(t, exe+".new", false)

		target := Target{Kind: KindLinuxTar, Path: exe}
		Cleanup(target)
		assertExists(t, exe+".old", false)
		assertExists(t, exe, true)
	})

	t.Run("tarball without the binary", func(t *testing.T) {
		dir := t.TempDir()
		exe := filepath.Join(dir, "restly")
		requireOK(t, os.WriteFile(exe, []byte("old"), 0o755))
		archive := filepath.Join(dir, "restly.tar.gz")
		writeTarGz(t, archive, "other", "new")

		requireError(t, "no binary", Install(t.Context(), Target{Kind: KindLinuxTar, Path: exe}, archive, false))
		if got := readFile(t, exe); got != "old" {
			t.Errorf("exe holds %q, want old", got)
		}
		assertExists(t, exe+".new", false)
	})

	t.Run("windows portable", func(t *testing.T) {
		dir := t.TempDir()
		exe := filepath.Join(dir, "Restly.exe")
		download := filepath.Join(dir, "Restly-portable.exe")
		requireOK(t, os.WriteFile(exe, []byte("old"), 0o755))
		requireOK(t, os.WriteFile(download, []byte("new"), 0o644))

		requireOK(t, Install(t.Context(), Target{Kind: KindWindowsPortable, Path: exe}, download, false))

		if got := readFile(t, exe); got != "new" {
			t.Errorf("exe holds %q, want new", got)
		}
		assertExists(t, exe+".old", true)
	})
}

func TestSwapFailureKeepsOldApp(t *testing.T) {
	t.Run("replacement missing", func(t *testing.T) {
		dir := t.TempDir()
		app := filepath.Join(dir, "app")
		requireOK(t, os.WriteFile(app, []byte("old"), 0o644))

		requireError(t, "missing replacement", swap(app, filepath.Join(dir, "absent")))

		if got := readFile(t, app); got != "old" {
			t.Errorf("app holds %q, want old", got)
		}
		assertExists(t, app+".old", false)
	})

	t.Run("read-only parent", func(t *testing.T) {
		if os.Geteuid() == 0 || runtime.GOOS == "windows" {
			t.Skip("directory permissions do not stop this user")
		}
		parent := filepath.Join(t.TempDir(), "apps")
		requireOK(t, os.Mkdir(parent, 0o755))
		app := filepath.Join(parent, "app")
		replacement := filepath.Join(t.TempDir(), "app.new")
		requireOK(t, os.WriteFile(app, []byte("old"), 0o644))
		requireOK(t, os.WriteFile(replacement, []byte("new"), 0o644))
		requireOK(t, os.Chmod(parent, 0o555))
		t.Cleanup(func() { os.Chmod(parent, 0o755) })

		requireError(t, "read-only parent", swap(app, replacement))

		if got := readFile(t, app); got != "old" {
			t.Errorf("app holds %q, want old", got)
		}
	})
}

func TestInstallMacApp(t *testing.T) {
	if runtime.GOOS != "darwin" || testing.Short() {
		t.Skip("needs hdiutil and is slow")
	}
	work := t.TempDir()

	source := filepath.Join(work, "source")
	newContents := filepath.Join(source, "Restly.app", "Contents")
	requireOK(t, os.MkdirAll(newContents, 0o755))
	requireOK(t, os.WriteFile(filepath.Join(newContents, "Info.plist"), []byte("version-new"), 0o644))
	dmg := filepath.Join(work, "Restly.dmg")
	output, err := exec.Command("hdiutil", "create", "-srcfolder", source, "-volname", "Restly", "-format", "UDZO", dmg).CombinedOutput()
	if err != nil {
		t.Fatalf("hdiutil create failed: %v: %s", err, output)
	}

	bundle := filepath.Join(work, "installed", "Restly.app")
	oldContents := filepath.Join(bundle, "Contents")
	requireOK(t, os.MkdirAll(oldContents, 0o755))
	requireOK(t, os.WriteFile(filepath.Join(oldContents, "Info.plist"), []byte("version-old"), 0o644))

	requireOK(t, Install(t.Context(), Target{Kind: KindMacApp, Path: bundle}, dmg, false))

	if got := readFile(t, filepath.Join(oldContents, "Info.plist")); got != "version-new" {
		t.Errorf("Info.plist holds %q, want version-new", got)
	}
	assertExists(t, bundle+".old", false)
	assertExists(t, bundle+".new", false)

	info, err := exec.Command("hdiutil", "info").CombinedOutput()
	requireOK(t, err)
	if strings.Contains(string(info), dmg) {
		t.Errorf("the DMG is still mounted:\n%s", info)
	}
}
