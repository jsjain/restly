package update

import "errors"

var (
	ErrNoticeOnly       = errors.New("this install cannot be updated in place")
	ErrAssetMissing     = errors.New("release has no such asset")
	ErrChecksumMissing  = errors.New("no checksum for asset")
	ErrChecksumMismatch = errors.New("checksum mismatch")
	ErrUntrustedURL     = errors.New("asset URL is not on the trusted origin")
)
