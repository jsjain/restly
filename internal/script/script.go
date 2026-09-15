// Package script runs Postman pre-request and test scripts in goja with a pm API shim.
package script

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"

	"restly/internal/collection"
	"restly/internal/vars"
)

// Run executes one script. The error reports a thrown exception or a timeout. The Output
// is still returned then, with the tests and console lines recorded before the failure.
func Run(ctx context.Context, in Input) (*Output, error) {
	timeout := in.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	ensureScope(&in)

	shim, err := compiledPMShim()
	if err != nil {
		return &Output{}, fmt.Errorf("failed to compile pm.js shim: %w", err)
	}
	userProgram, err := goja.Compile("script.js", wrapCode(in.Code), false)
	if err != nil {
		return &Output{}, fmt.Errorf("failed to compile script: %w", err)
	}
	reqData, err := requestJSON(in.Request)
	if err != nil {
		return &Output{}, err
	}
	var respData string
	if in.Event == "test" && in.Response != nil {
		if respData, err = responseJSON(in.Response); err != nil {
			return &Output{}, err
		}
	}
	infoData, err := infoJSON(in)
	if err != nil {
		return &Output{}, err
	}

	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	out := &Output{}
	loop := eventloop.NewEventLoop(eventloop.EnableConsole(false))
	loop.Start()
	defer loop.Terminate()

	done := make(chan string, 1) // buffered: the empty string means success
	vmReady := make(chan *goja.Runtime, 1)

	loop.RunOnLoop(func(vm *goja.Runtime) {
		vmReady <- vm
		if err := setupBridges(runCtx, vm, in, out, loop, done, reqData, respData, infoData); err != nil {
			sendDone(done, err.Error())
			return
		}
		if _, err := vm.RunProgram(shim); err != nil {
			sendDone(done, fmt.Sprintf("failed to load script shim: %v", err))
			return
		}
		if _, err := vm.RunProgram(userProgram); err != nil {
			// A synchronous failure here (only possible via vm.Interrupt) means the wrapper's
			// own .then/.catch never got attached, so __settleWrapper will never fire.
			sendDone(done, err.Error())
		}
	})

	select {
	case message := <-done:
		if message == "" {
			return out, nil
		}
		return out, errors.New(message)
	case <-runCtx.Done():
		// Interrupt only affects JS currently executing; a script parked on an unresolved
		// promise (e.g. a hung pm.sendRequest) needs the loop stopped instead, see Stop below.
		if vm := <-vmReady; vm != nil {
			vm.Interrupt("script timed out")
		}
		// Stop returns once the loop's goroutine has exited, so nothing touches vm or out
		// after this, even if a pending pm.sendRequest goroutine is still stuck in in.Send.
		loop.Stop()
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return out, fmt.Errorf("script timed out after %s", timeout)
		}
		return out, fmt.Errorf("script canceled: %w", ctx.Err())
	}
}

// ensureScope defaults a missing scope or missing scope maps so a nil map write from JS
// cannot crash the process with a Go-level panic goja can't turn into a JS exception.
func ensureScope(in *Input) {
	if in.Scope == nil {
		in.Scope = vars.New()
	}
	scopeMaps := []*map[string]string{
		&in.Scope.Local,
		&in.Scope.Data,
		&in.Scope.Environment,
		&in.Scope.Collection,
		&in.Scope.Globals,
	}
	for _, scopeMap := range scopeMaps {
		if *scopeMap == nil {
			*scopeMap = map[string]string{}
		}
	}
}

// sendDone is a non-blocking send: __host.finish and the two RunProgram error paths in Run
// each have their own reason to send, but at most one of them ever actually fires per call.
func sendDone(done chan string, message string) {
	select {
	case done <- message:
	default:
	}
}

// setupBridges defines every Go-backed global pm.js and the wrapped script rely on. It runs
// once per Run call, on the event loop's own goroutine.
func setupBridges(
	ctx context.Context,
	vm *goja.Runtime,
	in Input,
	out *Output,
	loop *eventloop.EventLoop,
	done chan string,
	reqData, respData, infoData string,
) error {
	globals := map[string]any{
		"__local":        in.Scope.Local,
		"__data":         in.Scope.Data,
		"__environment":  in.Scope.Environment,
		"__collection":   in.Scope.Collection,
		"__globals":      in.Scope.Globals,
		"__requestJSON":  reqData,
		"__responseJSON": respData,
		"__infoJSON":     infoData,
		"atob":           decodeBase64,
		"btoa":           encodeBase64,
	}
	for name, value := range globals {
		if err := vm.Set(name, value); err != nil {
			return fmt.Errorf("failed to set %s: %w", name, err)
		}
	}

	// loadChai and require are called from JS, so panicking with a goja error here is the
	// sanctioned way to raise a catchable JS exception (goja itself does this internally).
	chaiLoaded := false
	loadChai := func() goja.Value {
		if !chaiLoaded {
			program, err := compiledChai()
			if err != nil {
				panic(vm.NewGoError(fmt.Errorf("failed to load chai: %w", err)))
			}
			if _, err := vm.RunProgram(program); err != nil {
				panic(vm.NewGoError(fmt.Errorf("failed to load chai: %w", err)))
			}
			chaiLoadCount.Add(1)
			chaiLoaded = true
		}
		return vm.Get("chai")
	}
	// loadCryptoJS mirrors loadChai, returning the library value straight to pm.js's getter
	// instead of assigning a "CryptoJS" global itself: pm.js's global CryptoJS is still the
	// bare accessor property at this point (it only replaces itself with the loaded value
	// once the getter returns), so a Go-side assignment here would hit that same accessor
	// with no setter and fail. crypto-js reads its "crypto" global once, at load time (see
	// cryptoSecureRandomInt in crypto-js.js), so setGetRandomValues runs first.
	cryptoJSLoaded := false
	var cryptoJSValue goja.Value
	loadCryptoJS := func() goja.Value {
		if !cryptoJSLoaded {
			setGetRandomValues(vm)
			program, err := compiledCryptoJS()
			if err != nil {
				panic(vm.NewGoError(fmt.Errorf("failed to load crypto-js: %w", err)))
			}
			value, err := vm.RunProgram(program)
			if err != nil {
				panic(vm.NewGoError(fmt.Errorf("failed to load crypto-js: %w", err)))
			}
			cryptoJSValue = value
			cryptoJSLoadCount.Add(1)
			cryptoJSLoaded = true
		}
		return cryptoJSValue
	}

	// require.Registry.Enable (inside NewEventLoop) already set a Node-style require; this
	// overwrites it so the sandbox only ever exposes chai and crypto-js.
	if err := vm.Set("require", func(name string) goja.Value {
		switch name {
		case "chai":
			return loadChai()
		case "crypto-js":
			return loadCryptoJS()
		default:
			panic(vm.NewGoError(fmt.Errorf("require('%s') is not available in Restly", name)))
		}
	}); err != nil {
		return fmt.Errorf("failed to set require: %w", err)
	}

	host := vm.NewObject()
	hostFuncs := map[string]any{
		"log":          func(line string) { out.Console = append(out.Console, line) },
		"replace":      func(text string) string { return in.Scope.Replace(text) },
		"loadChai":     loadChai,
		"loadCryptoJS": loadCryptoJS,
		"reserveTest": func(name string) int {
			out.Tests = append(out.Tests, TestResult{Name: name})
			return len(out.Tests) - 1
		},
		"fillTest": func(index int, passed bool, errMessage string) {
			if index >= 0 && index < len(out.Tests) {
				out.Tests[index].Passed = passed
				out.Tests[index].Error = errMessage
			}
		},
		"setNextRequest": func(name string, isNull bool) {
			if isNull {
				name = ""
			}
			out.NextRequest = &name
		},
		"skipRequest": func() { out.SkipRequest = true },
		"sendRequest": func(requestJSONText string) *goja.Promise {
			return sendRequest(ctx, vm, loop, in, requestJSONText)
		},
		"finish": func(errMessage string) {
			if in.Event == "prerequest" {
				if writeErr := writeBackRequest(vm, in.Request); writeErr != nil && errMessage == "" {
					errMessage = writeErr.Error()
				}
			}
			sendDone(done, errMessage)
		},
	}
	for name, value := range hostFuncs {
		if err := host.Set(name, value); err != nil {
			return fmt.Errorf("failed to set host.%s: %w", name, err)
		}
	}
	if err := vm.Set("__host", host); err != nil {
		return fmt.Errorf("failed to set __host: %w", err)
	}
	return nil
}

// sendRequest backs pm.sendRequest: it runs in.Send in a goroutine (I/O must not block the
// event loop) and resolves the promise back on the loop, as goja's Promise docs require.
func sendRequest(ctx context.Context, vm *goja.Runtime, loop *eventloop.EventLoop, in Input, requestJSONText string) *goja.Promise {
	promise, resolve, reject := vm.NewPromise()
	// resolve/reject only return an error for uncatchable failures (e.g. the runtime was
	// already interrupted); there is nothing more useful to do with that error here.
	if in.Send == nil {
		_ = reject(vm.NewGoError(errors.New("pm.sendRequest requires a Send function, but none was configured")))
		return promise
	}
	var req collection.Request
	if err := json.Unmarshal([]byte(requestJSONText), &req); err != nil {
		_ = reject(vm.NewGoError(fmt.Errorf("failed to read pm.sendRequest request: %w", err)))
		return promise
	}
	go func() {
		resp, err := in.Send(ctx, &req)
		loop.RunOnLoop(func(vm *goja.Runtime) {
			if err != nil {
				_ = reject(vm.NewGoError(err))
				return
			}
			payload, marshalErr := responseJSON(resp)
			if marshalErr != nil {
				_ = reject(vm.NewGoError(marshalErr))
				return
			}
			_ = resolve(vm.ToValue(payload))
		})
	}()
	return promise
}
