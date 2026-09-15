package script

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/dop251/goja"

	"restly/internal/collection"
	"restly/internal/httpx"
)

// chaiLoadCount counts how many times chai was actually evaluated into a runtime, so tests
// can confirm a script that never touches pm.expect skips the cost of loading it.
var chaiLoadCount atomic.Int64

// cryptoJSLoadCount is chaiLoadCount's counterpart for crypto-js.
var cryptoJSLoadCount atomic.Int64

var (
	pmShimOnce    sync.Once
	pmShimProgram *goja.Program
	pmShimErr     error

	chaiOnce    sync.Once
	chaiProgram *goja.Program
	chaiErr     error

	cryptoJSOnce    sync.Once
	cryptoJSProgram *goja.Program
	cryptoJSErr     error
)

// compiledPMShim compiles pm.js once and reuses the bytecode across every Run call.
func compiledPMShim() (*goja.Program, error) {
	pmShimOnce.Do(func() {
		pmShimProgram, pmShimErr = goja.Compile("pm.js", pmShimSource, false)
	})
	return pmShimProgram, pmShimErr
}

// compiledChai wraps chai.js as a CommonJS module, matching the load recipe verified to work
// with this chai build, and compiles it once. Running it into a runtime still costs a few
// milliseconds, so callers only do that lazily, the first time a script touches pm.expect.
func compiledChai() (*goja.Program, error) {
	chaiOnce.Do(func() {
		wrapped := "var module={exports:{}},exports=module.exports;" + chaiSource + ";var chai=module.exports;"
		chaiProgram, chaiErr = goja.Compile("chai.js", wrapped, false)
	})
	return chaiProgram, chaiErr
}

// compiledCryptoJS wraps crypto-js.js as a CommonJS module inside its own IIFE, so its
// module/exports locals never touch the runtime's global object (unlike chai's, which are
// plain globals). That keeps the two vendored libraries from clobbering each other's
// module/exports if a script loads both in one runtime. Compiled once and reused.
func compiledCryptoJS() (*goja.Program, error) {
	cryptoJSOnce.Do(func() {
		wrapped := "(function(){var module={exports:{}},exports=module.exports;" + cryptoJSSource + ";return module.exports;})()"
		cryptoJSProgram, cryptoJSErr = goja.Compile("crypto-js.js", wrapped, false)
	})
	return cryptoJSProgram, cryptoJSErr
}

// wrapCode wraps user code in an async IIFE on the same first line so line numbers in
// thrown errors still point at the original source. __settleWrapper is defined by pm.js.
func wrapCode(code string) string {
	return "(async () => {" + code + "\n})().then(function(){__settleWrapper(true);}, function(err){__settleWrapper(false, err);});"
}

type infoPayload struct {
	EventName      string `json:"eventName"`
	Iteration      int    `json:"iteration"`
	IterationCount int    `json:"iterationCount"`
	RequestName    string `json:"requestName"`
	RequestID      string `json:"requestId"`
}

func infoJSON(in Input) (string, error) {
	data, err := json.Marshal(infoPayload{
		EventName:      in.Event,
		Iteration:      in.Info.Iteration,
		IterationCount: in.Info.IterationCount,
		RequestName:    in.Info.RequestName,
	})
	if err != nil {
		return "", fmt.Errorf("failed to marshal pm.info: %w", err)
	}
	return string(data), nil
}

type responsePayload struct {
	Code         int            `json:"code"`
	Status       string         `json:"status"`
	Headers      []httpx.Header `json:"headers"`
	Cookies      []httpx.Cookie `json:"cookies"`
	Body         string         `json:"body"`
	Size         int            `json:"size"`
	ResponseTime float64        `json:"responseTime"`
}

func responseJSON(resp *httpx.Response) (string, error) {
	data, err := json.Marshal(responsePayload{
		Code:         resp.Code,
		Status:       resp.Status,
		Headers:      resp.Header,
		Cookies:      resp.Cookies,
		Body:         string(resp.Body),
		Size:         resp.Size,
		ResponseTime: resp.Timings.Total,
	})
	if err != nil {
		return "", fmt.Errorf("failed to marshal response: %w", err)
	}
	return string(data), nil
}

// requestJSON gives the script pm.request as Postman's own request JSON shape.
func requestJSON(req *collection.Request) (string, error) {
	if req == nil {
		return "{}", nil
	}
	data, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}
	return string(data), nil
}

// writeBackRequest applies pm.request's final state (read from the runtime's __reqData
// global) back onto req, the same way a load-then-save round trip would. It only replaces
// req once the new value has fully decoded, so a bad script assignment (e.g. a number where
// a string field belongs) reports an error instead of leaving req blank.
func writeBackRequest(vm *goja.Runtime, req *collection.Request) error {
	if req == nil {
		return nil
	}
	value := vm.Get("__reqData")
	if value == nil || goja.IsUndefined(value) {
		return nil
	}
	data, err := json.Marshal(value.Export())
	if err != nil {
		return fmt.Errorf("failed to export pm.request: %w", err)
	}
	var updated collection.Request
	if err := json.Unmarshal(data, &updated); err != nil {
		return fmt.Errorf("failed to apply pm.request changes: %w", err)
	}
	*req = updated
	return nil
}

// setGetRandomValues defines a global crypto.getRandomValues backed by crypto/rand, the one
// global crypto-js.js looks for (via globalThis.crypto) to seed WordArray.random and AES's
// passphrase key derivation. It fills the raw bytes behind whatever typed array is passed,
// which works for any element width without needing a case per typed-array kind.
func setGetRandomValues(vm *goja.Runtime) {
	getRandomValues := func(call goja.FunctionCall) goja.Value {
		arg := call.Argument(0)
		obj := arg.ToObject(vm)
		bufVal := obj.Get("buffer")
		if bufVal == nil || goja.IsUndefined(bufVal) {
			panic(vm.NewTypeError("crypto.getRandomValues: argument must be an integer-typed array"))
		}
		ab, ok := bufVal.Export().(goja.ArrayBuffer)
		if !ok {
			panic(vm.NewTypeError("crypto.getRandomValues: argument must be an integer-typed array"))
		}
		byteOffset := int(obj.Get("byteOffset").ToInteger())
		byteLength := int(obj.Get("byteLength").ToInteger())
		view := ab.Bytes()[byteOffset : byteOffset+byteLength]
		if _, err := rand.Read(view); err != nil {
			panic(vm.NewGoError(fmt.Errorf("crypto.getRandomValues: %w", err)))
		}
		return arg
	}
	cryptoObj := vm.NewObject()
	_ = cryptoObj.Set("getRandomValues", getRandomValues)
	_ = vm.Set("crypto", cryptoObj)
}

func decodeBase64(encoded string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("atob: %w", err)
	}
	return string(data), nil
}

func encodeBase64(text string) string {
	return base64.StdEncoding.EncodeToString([]byte(text))
}
