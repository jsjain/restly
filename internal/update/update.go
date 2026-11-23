package update

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// Latest fetches the newest release from feedURL.
func Latest(ctx context.Context, client *http.Client, feedURL string) (Release, error) {
	resp, err := fetch(ctx, client, feedURL, acceptFeed)
	if err != nil {
		return Release{}, fmt.Errorf("failed to fetch release feed: %w", err)
	}
	defer resp.Body.Close()

	var feed feedRelease
	if err := json.NewDecoder(resp.Body).Decode(&feed); err != nil {
		return Release{}, fmt.Errorf("failed to decode release feed: %w", err)
	}
	release := Release{
		Version: strings.TrimPrefix(feed.TagName, "v"),
		PageURL: feed.HTMLURL,
		Assets:  make(map[string]string, len(feed.Assets)),
	}
	for _, asset := range feed.Assets {
		release.Assets[asset.Name] = asset.URL
	}
	return release, nil
}

// Newer reports whether candidate is a higher vMAJOR.MINOR.PATCH than current. Either one being
// anything else (a pre-release tag, a dev build) gives false.
func Newer(candidate, current string) bool {
	candidateParts, ok := parseVersion(candidate)
	if !ok {
		return false
	}
	currentParts, ok := parseVersion(current)
	if !ok {
		return false
	}
	for i := range candidateParts {
		if candidateParts[i] != currentParts[i] {
			return candidateParts[i] > currentParts[i]
		}
	}
	return false
}

// Detect works out how exe was installed. A copy whose folder cannot be written is notice only.
func Detect(exe, goos string) Target {
	target := Target{Kind: KindNoticeOnly, Path: exe}
	switch goos {
	case "darwin":
		macOSDir := filepath.Dir(exe)
		bundle := filepath.Dir(filepath.Dir(macOSDir))
		if filepath.Base(macOSDir) != "MacOS" || !strings.HasSuffix(bundle, ".app") {
			return target
		}
		target = Target{Kind: KindMacApp, Path: bundle}
	case "windows":
		kind := KindWindowsPortable
		if _, err := os.Stat(filepath.Join(filepath.Dir(exe), uninstallerName)); err == nil {
			kind = KindWindowsSetup
		}
		target.Kind = kind
	case "linux":
		if strings.HasPrefix(exe, linuxSystemRoot) {
			return target
		}
		target.Kind = KindLinuxTar
	}
	if !writable(filepath.Dir(target.Path)) {
		target.Kind = KindNoticeOnly
	}
	return target
}

// AssetName is the release file for kind on goarch, or "" when kind has none.
func AssetName(kind Kind, goarch, version string) string {
	switch kind {
	case KindMacApp:
		arch := "intel"
		if goarch == "arm64" {
			arch = "apple-silicon"
		}
		return fmt.Sprintf("Restly-%s-macos-%s.dmg", version, arch)
	case KindWindowsSetup:
		return fmt.Sprintf("Restly-%s-windows-amd64-setup.exe", version)
	case KindWindowsPortable:
		return fmt.Sprintf("Restly-%s-windows-amd64-portable.exe", version)
	case KindLinuxTar:
		return fmt.Sprintf("Restly-%s-linux-amd64.tar.gz", version)
	default:
		return ""
	}
}

// Download saves asset name from rel into dir and returns its path. The file appears under its
// final name only after its SHA-256 matches the release's checksum file.
func Download(ctx context.Context, client *http.Client, rel Release, name, dir string, origin *url.URL) (string, error) {
	assetURL, ok := rel.Assets[name]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrAssetMissing, name)
	}
	sumsURL, ok := rel.Assets[checksumsName]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrAssetMissing, checksumsName)
	}
	for _, rawURL := range []string{assetURL, sumsURL} {
		if err := checkOrigin(rawURL, origin); err != nil {
			return "", err
		}
	}

	sums, err := fetchChecksums(ctx, client, sumsURL)
	if err != nil {
		return "", err
	}
	want, ok := sums[name]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrChecksumMissing, name)
	}
	if err := os.MkdirAll(dir, dirMode); err != nil {
		return "", fmt.Errorf("failed to create update folder %s: %w", dir, err)
	}
	return downloadVerified(ctx, client, assetURL, filepath.Join(dir, name), want)
}
