package curl

// kvPair is a generic key/value pair collected while parsing flags.
type kvPair struct {
	Key   string
	Value string
}

// formField is one -F/--form-string field before it becomes formdata JSON.
type formField struct {
	Key    string
	Value  string
	IsFile bool
}

// parsedCommand accumulates everything read from the command line before buildItem
// turns it into a Postman request item.
type parsedCommand struct {
	url    string
	urlSet bool

	method    string
	methodSet bool

	headers []kvPair

	dataParts          []string // raw/urlencoded body pieces, in command-line order
	dataFlagCount      int      // occurrences of -d/--data/--data-binary/--data-ascii/--data-raw
	dataURLEncodeCount int
	fileCandidates     []string // "@path" values seen on non-data-raw data flags

	formFields []formField

	getFlag  bool
	headFlag bool

	basicUser    string
	basicPass    string
	hasBasicAuth bool
}

// flagKind names what a recognized flag does to parsedCommand.
type flagKind int

const (
	flagURL flagKind = iota
	flagMethod
	flagHeader
	flagData
	flagDataRaw
	flagDataURLEncode
	flagForm
	flagFormString
	flagUser
	flagCookie
	flagUserAgent
	flagReferer
	flagGet
	flagHead
	flagIgnore
)

// flagSpec is one row of the flag table: its long and/or short spelling, what it does,
// and whether it consumes the next token as a value.
type flagSpec struct {
	long       string
	short      byte
	kind       flagKind
	takesValue bool
}

// Postman v2.1 JSON shapes. curl.go builds these, marshals them, and unmarshals the
// result into collection.Item so the collection package's own decoding fills in the
// fields (such as URL host/path) it derives rather than stores directly.
type postmanItem struct {
	Name    string         `json:"name"`
	Request postmanRequest `json:"request"`
}

type postmanRequest struct {
	Method string       `json:"method"`
	Header []postmanKV  `json:"header,omitempty"`
	URL    postmanURL   `json:"url"`
	Body   *postmanBody `json:"body,omitempty"`
	Auth   *postmanAuth `json:"auth,omitempty"`
}

type postmanKV struct {
	Key   string `json:"key"`
	Value string `json:"value,omitempty"`
	Type  string `json:"type,omitempty"`
	Src   string `json:"src,omitempty"`
}

type postmanURL struct {
	Raw   string      `json:"raw"`
	Query []postmanKV `json:"query,omitempty"`
}

type postmanBody struct {
	Mode       string              `json:"mode"`
	Raw        string              `json:"raw,omitempty"`
	URLEncoded []postmanKV         `json:"urlencoded,omitempty"`
	FormData   []postmanKV         `json:"formdata,omitempty"`
	File       *postmanFile        `json:"file,omitempty"`
	Options    *postmanBodyOptions `json:"options,omitempty"`
}

type postmanFile struct {
	Src string `json:"src"`
}

type postmanBodyOptions struct {
	Raw postmanRawOptions `json:"raw"`
}

type postmanRawOptions struct {
	Language string `json:"language,omitempty"`
}

type postmanAuth struct {
	Type  string      `json:"type"`
	Basic []postmanKV `json:"basic,omitempty"`
}
