// Package update looks up GitHub releases, verifies downloads and swaps the running app for a new build.
package update

// Kind says how this copy of Restly was installed, which decides the asset and the install steps.
type Kind string

// Release is the latest GitHub release.
type Release struct {
	Version string            // without the leading "v"
	PageURL string            // the release page
	Assets  map[string]string // file name to download URL
}

// Target is the installed copy of Restly.
type Target struct {
	Kind Kind
	Path string // the .app bundle for KindMacApp, otherwise the executable
}

type feedRelease struct {
	TagName string      `json:"tag_name"`
	HTMLURL string      `json:"html_url"`
	Assets  []feedAsset `json:"assets"`
}

type feedAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}
