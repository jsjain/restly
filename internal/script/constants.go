package script

import (
	_ "embed"
	"time"
)

// DefaultTimeout stops a runaway script from hanging a request or a run.
const DefaultTimeout = 30 * time.Second

//go:embed chai.js
var chaiSource string

//go:embed crypto-js.js
var cryptoJSSource string

//go:embed pm.js
var pmShimSource string
