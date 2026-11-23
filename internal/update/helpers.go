package update

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strconv"
	"strings"
)

func parseVersion(raw string) ([3]int, bool) {
	var parts [3]int
	match := stableVersion.FindStringSubmatch(raw)
	if match == nil {
		return parts, false
	}
	for i := range parts {
		number, err := strconv.Atoi(match[i+1])
		if err != nil {
			return parts, false
		}
		parts[i] = number
	}
	return parts, true
}

// writable creates and removes a temp file in dir, which is the only reliable check across platforms.
func writable(dir string) bool {
	probe, err := os.CreateTemp(dir, probePattern)
	if err != nil {
		return false
	}
	closeErr := probe.Close()
	removeErr := os.Remove(probe.Name())
	return closeErr == nil && removeErr == nil
}

func checkOrigin(rawURL string, origin *url.URL) error {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != origin.Scheme || parsed.Host != origin.Host {
		return fmt.Errorf("%w: %s", ErrUntrustedURL, rawURL)
	}
	return nil
}

// fetch returns the response of a 200 GET. The caller closes the body.
func fetch(ctx context.Context, client *http.Client, rawURL, accept string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build request for %s: %w", rawURL, err)
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", accept)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to GET %s: %w", rawURL, err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("GET %s returned status %d", rawURL, resp.StatusCode)
	}
	return resp, nil
}

// fetchChecksums parses "<hex>  <name>" lines into name to lowercase hex.
func fetchChecksums(ctx context.Context, client *http.Client, rawURL string) (map[string]string, error) {
	resp, err := fetch(ctx, client, rawURL, acceptBinary)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch %s: %w", checksumsName, err)
	}
	defer resp.Body.Close()

	sums := map[string]string{}
	scanner := bufio.NewScanner(io.LimitReader(resp.Body, maxChecksumsBytes))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 2 {
			sums[strings.TrimPrefix(fields[1], "*")] = strings.ToLower(fields[0])
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("failed to read %s: %w", checksumsName, err)
	}
	return sums, nil
}

// downloadVerified streams rawURL into a temp file beside finalPath and renames it into place
// only when its SHA-256 equals wantSum. Any failure removes the temp file.
func downloadVerified(ctx context.Context, client *http.Client, rawURL, finalPath, wantSum string) (_ string, err error) {
	tmp, err := os.CreateTemp(filepath.Dir(finalPath), filepath.Base(finalPath)+".part-*")
	if err != nil {
		return "", fmt.Errorf("failed to create download file for %s: %w", finalPath, err)
	}
	defer func() {
		if err != nil {
			tmp.Close()
			os.Remove(tmp.Name())
		}
	}()

	resp, err := fetch(ctx, client, rawURL, acceptBinary)
	if err != nil {
		return "", fmt.Errorf("failed to download asset: %w", err)
	}
	defer resp.Body.Close()

	hasher := sha256.New()
	if _, err = io.Copy(io.MultiWriter(tmp, hasher), resp.Body); err != nil {
		return "", fmt.Errorf("failed to write %s: %w", finalPath, err)
	}
	if got := hex.EncodeToString(hasher.Sum(nil)); got != wantSum {
		return "", fmt.Errorf("%w: %s is %s, want %s", ErrChecksumMismatch, filepath.Base(finalPath), got, wantSum)
	}
	if err = tmp.Close(); err != nil {
		return "", fmt.Errorf("failed to close %s: %w", tmp.Name(), err)
	}
	if err = os.Rename(tmp.Name(), finalPath); err != nil {
		return "", fmt.Errorf("failed to move download to %s: %w", finalPath, err)
	}
	return finalPath, nil
}

// swap moves replacement over target, keeping the old one as target+".old". If the second rename
// fails the old target is put back, so a failed swap leaves the running app in place.
func swap(target, replacement string) error {
	old := target + oldSuffix
	if err := os.RemoveAll(old); err != nil {
		return fmt.Errorf("failed to clear %s: %w", old, err)
	}
	if err := os.Rename(target, old); err != nil {
		return fmt.Errorf("failed to move %s aside: %w", target, err)
	}
	if err := os.Rename(replacement, target); err != nil {
		if restoreErr := os.Rename(old, target); restoreErr != nil {
			return errors.Join(fmt.Errorf("failed to move %s into place: %w", replacement, err), restoreErr)
		}
		return fmt.Errorf("failed to move %s into place: %w", replacement, err)
	}
	return nil
}

// writeBinary writes src to dst as an executable and removes dst on failure.
func writeBinary(dst string, src io.Reader) (err error) {
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, execMode)
	if err != nil {
		return fmt.Errorf("failed to create %s: %w", dst, err)
	}
	defer func() {
		if err != nil {
			os.Remove(dst)
		}
	}()
	if _, err = io.Copy(out, src); err != nil {
		out.Close()
		return fmt.Errorf("failed to write %s: %w", dst, err)
	}
	if err = out.Close(); err != nil {
		return fmt.Errorf("failed to close %s: %w", dst, err)
	}
	// The umask can strip bits from the mode given to OpenFile.
	if err = os.Chmod(dst, execMode); err != nil {
		return fmt.Errorf("failed to make %s executable: %w", dst, err)
	}
	return nil
}

func writeFileAsBinary(dst, src string) error {
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("failed to open %s: %w", src, err)
	}
	defer in.Close()
	return writeBinary(dst, in)
}

// writeTarBinary extracts the "restly" entry at the root of the tar.gz at src.
func writeTarBinary(dst, src string) error {
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("failed to open %s: %w", src, err)
	}
	defer in.Close()
	zr, err := gzip.NewReader(in)
	if err != nil {
		return fmt.Errorf("failed to read %s as gzip: %w", src, err)
	}
	defer zr.Close()

	reader := tar.NewReader(zr)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return fmt.Errorf("%s has no %s at its root", src, linuxBinaryName)
		}
		if err != nil {
			return fmt.Errorf("failed to read %s: %w", src, err)
		}
		if header.Typeflag == tar.TypeReg && path.Clean(header.Name) == linuxBinaryName {
			return writeBinary(dst, reader)
		}
	}
}

// run executes name with args and puts its output in the error.
func run(ctx context.Context, name string, args ...string) error {
	output, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s failed: %w: %s", name, strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return nil
}

// startDetached starts a process that must outlive Restly, so the caller's cancellation does not reach it.
func startDetached(ctx context.Context, name string, args ...string) error {
	return startCommand(exec.CommandContext(context.WithoutCancel(ctx), name, args...))
}

func startCommand(cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start %s: %w", cmd.Path, err)
	}
	return cmd.Process.Release()
}

// windowsSetupCmdLine is the raw "cmd /c" line that waits for Restly to exit, runs the silent
// installer into the folder Restly runs from, and starts Restly again when relaunch is set. Paths are
// quoted for cmd, not for Go. NSIS takes /D last and unquoted, even with spaces.
// ponytail: a folder name holding & or % breaks the cmd line; quote-escaping for cmd if anyone hits it.
func windowsSetupCmdLine(setup, exe string, relaunch bool) string {
	// ping is the delay because timeout refuses to run without a console.
	dir := exe // a Windows path, so filepath.Dir would not split it when tests run elsewhere
	if i := strings.LastIndexAny(exe, `\/`); i >= 0 {
		dir = exe[:i]
	}
	line := fmt.Sprintf(`ping -n 3 127.0.0.1 >nul & start /wait "" "%s" /S /D=%s`, setup, dir)
	if relaunch {
		line += fmt.Sprintf(` & start "" "%s"`, exe)
	}
	return `cmd /c "` + line + `"`
}
