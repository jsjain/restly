package update

import "regexp"

const (
	KindMacApp          Kind = "mac-app"
	KindWindowsSetup    Kind = "windows-setup"
	KindWindowsPortable Kind = "windows-portable"
	KindLinuxTar        Kind = "linux-tar"
	KindNoticeOnly      Kind = "notice-only"
)

const (
	userAgent    = "Restly-updater"
	acceptFeed   = "application/vnd.github+json"
	acceptBinary = "application/octet-stream"

	checksumsName = "SHA256SUMS.txt"

	// maxChecksumsBytes bounds the checksum file read into memory.
	maxChecksumsBytes = 1 << 20 // 1 MB

	oldSuffix = ".old"
	newSuffix = ".new"

	dirMode  = 0o700
	execMode = 0o755

	macBundleName   = "Restly.app"
	linuxBinaryName = "restly"
	uninstallerName = "uninstall.exe"
	probePattern    = ".restly-write-*"
	linuxSystemRoot = "/usr/"
)

// stableVersion matches vMAJOR.MINOR.PATCH only, so pre-releases and odd tags are never offered.
var stableVersion = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)$`)
