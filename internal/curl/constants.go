package curl

// flagTable is the one source of truth for every recognized flag and its value arity.
// Both long and short flag lookups scan this table; a curl command has only a handful
// of flags, so a linear scan costs nothing next to tokenizing and parsing it.
var flagTable = []flagSpec{
	{long: "url", kind: flagURL, takesValue: true},
	{long: "request", short: 'X', kind: flagMethod, takesValue: true},
	{long: "header", short: 'H', kind: flagHeader, takesValue: true},
	{long: "data", short: 'd', kind: flagData, takesValue: true},
	{long: "data-raw", kind: flagDataRaw, takesValue: true},
	{long: "data-binary", kind: flagData, takesValue: true},
	{long: "data-ascii", kind: flagData, takesValue: true},
	{long: "data-urlencode", kind: flagDataURLEncode, takesValue: true},
	{long: "form", short: 'F', kind: flagForm, takesValue: true},
	{long: "form-string", kind: flagFormString, takesValue: true},
	{long: "user", short: 'u', kind: flagUser, takesValue: true},
	{long: "cookie", short: 'b', kind: flagCookie, takesValue: true},
	{long: "user-agent", short: 'A', kind: flagUserAgent, takesValue: true},
	{long: "referer", short: 'e', kind: flagReferer, takesValue: true},
	{long: "get", short: 'G', kind: flagGet, takesValue: false},
	{long: "head", short: 'I', kind: flagHead, takesValue: false},

	// Known flags that don't change the request Restly builds. Ones that take a value
	// must still consume it, or that value would be mistaken for the URL.
	{long: "compressed", kind: flagIgnore, takesValue: false},
	{long: "insecure", short: 'k', kind: flagIgnore, takesValue: false},
	{long: "location", short: 'L', kind: flagIgnore, takesValue: false},
	{long: "silent", short: 's', kind: flagIgnore, takesValue: false},
	{long: "show-error", short: 'S', kind: flagIgnore, takesValue: false},
	{long: "verbose", short: 'v', kind: flagIgnore, takesValue: false},
	{long: "include", short: 'i', kind: flagIgnore, takesValue: false},
	{long: "http1.1", kind: flagIgnore, takesValue: false},
	{long: "http2", kind: flagIgnore, takesValue: false},
	{long: "output", short: 'o', kind: flagIgnore, takesValue: true},
	{long: "max-time", short: 'm', kind: flagIgnore, takesValue: true},
	{long: "connect-timeout", kind: flagIgnore, takesValue: true},
	{long: "retry", kind: flagIgnore, takesValue: true},
	{long: "write-out", short: 'w', kind: flagIgnore, takesValue: true},
}

// defaultContentTypeForData is what curl sends for any -d/--data-family body when the
// command sets no Content-Type header itself.
const defaultContentTypeForData = "application/x-www-form-urlencoded"
