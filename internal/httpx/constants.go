package httpx

// encodeSpecials are the extra bytes percent-encoded in a URL query component, matching
// postman-url-encoder's rule set (C0 controls and non-ASCII bytes are handled separately).
const encodeSpecials = " \"#&'<>"

const (
	defaultUserAgent = "Restly/0.1"
	defaultAccept    = "*/*"
)

// Proxy modes for Network.ProxyMode.
const (
	ProxyNone = "none"
	// ProxyEnvironment reads HTTP_PROXY, HTTPS_PROXY, and NO_PROXY. Apps opened from the macOS Finder do not have them.
	ProxyEnvironment = "environment"
	ProxyCustom      = "custom"
)
