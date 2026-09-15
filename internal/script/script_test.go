package script

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"restly/internal/collection"
	"restly/internal/httpx"
	"restly/internal/vars"
)

// fakeResponse builds a canned *httpx.Response so tests never touch the network.
func fakeResponse(code int, status string, body string, headers ...httpx.Header) *httpx.Response {
	return &httpx.Response{
		Code:    code,
		Status:  status,
		Header:  headers,
		Body:    []byte(body),
		Size:    len(body),
		Timings: httpx.Timings{Total: 12.5},
	}
}

func newScope() *vars.Scope {
	return vars.New()
}

func TestRun_JSONResponseIntoVariable(t *testing.T) {
	in := Input{
		Code:     `var jsonData = pm.response.json(); pm.collectionVariables.set("token", jsonData.data.token);`,
		Event:    "test",
		Scope:    newScope(),
		Response: fakeResponse(200, "OK", `{"data":{"token":"abc123"}}`),
	}
	out, err := Run(context.Background(), in)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := in.Scope.Collection["token"]; got != "abc123" {
		t.Fatalf("collectionVariables[token] = %q, want abc123 (console: %v)", got, out.Console)
	}
}

func TestRun_RestlyAliasesPm(t *testing.T) {
	in := Input{
		Code:     "restly.collectionVariables.set(\"TOKEN\", `Bearer ${restly.response.json().access_token}`); pm.environment.set(\"same\", restly === pm);",
		Event:    "test",
		Scope:    newScope(),
		Response: fakeResponse(200, "OK", `{"access_token":"abc123"}`),
	}
	out, err := Run(context.Background(), in)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := in.Scope.Collection["TOKEN"]; got != "Bearer abc123" {
		t.Fatalf("collectionVariables[TOKEN] = %q, want Bearer abc123 (console: %v)", got, out.Console)
	}
	if got := in.Scope.Environment["same"]; got != "true" {
		t.Fatalf("environment[same] = %q, want true", got)
	}
}

func TestRun_StatusAssertionPasses(t *testing.T) {
	in := Input{
		Code:     `pm.test("Status code is 200", function () { pm.response.to.have.status(200); });`,
		Event:    "test",
		Scope:    newScope(),
		Response: fakeResponse(200, "OK", `{}`),
	}
	out, err := Run(context.Background(), in)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(out.Tests) != 1 || !out.Tests[0].Passed {
		t.Fatalf("tests = %+v, want one passing test", out.Tests)
	}
}

func TestRun_ChaiDeepEqualFailure(t *testing.T) {
	in := Input{
		Code:  `pm.test("numbers match", function () { pm.expect(1).to.eql(2); });`,
		Event: "test",
		Scope: newScope(),
	}
	out, err := Run(context.Background(), in)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(out.Tests) != 1 {
		t.Fatalf("tests = %+v, want exactly one test", out.Tests)
	}
	if out.Tests[0].Passed {
		t.Fatalf("test unexpectedly passed")
	}
	if out.Tests[0].Error == "" {
		t.Fatalf("expected a failure message")
	}
	t.Logf("failure message: %s", out.Tests[0].Error)
}

func TestRun_SendRequestAwaited(t *testing.T) {
	in := Input{
		Code:  `const res = await pm.sendRequest("https://x.test/id"); pm.environment.set("id", res.json().id);`,
		Event: "prerequest",
		Scope: newScope(),
		Send: func(ctx context.Context, req *collection.Request) (*httpx.Response, error) {
			if req.URL == nil || req.URL.Raw != "https://x.test/id" {
				t.Errorf("Send got url %+v", req.URL)
			}
			return fakeResponse(200, "OK", `{"id":"42"}`), nil
		},
	}
	out, err := Run(context.Background(), in)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := in.Scope.Environment["id"]; got != "42" {
		t.Fatalf("environment[id] = %q, want 42 (console: %v)", got, out.Console)
	}
}

func TestRun_SendRequestCallbackCompletesBeforeReturn(t *testing.T) {
	in := Input{
		Code: `pm.sendRequest("https://x.test/cb", function (err, res) {
			if (err) { pm.environment.set("cbError", String(err)); return; }
			pm.environment.set("cbBody", res.text());
		});`,
		Event: "prerequest",
		Scope: newScope(),
		Send: func(ctx context.Context, req *collection.Request) (*httpx.Response, error) {
			return fakeResponse(200, "OK", "callback-body"), nil
		},
	}
	out, err := Run(context.Background(), in)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := in.Scope.Environment["cbBody"]; got != "callback-body" {
		t.Fatalf("environment[cbBody] = %q, want callback-body (console: %v)", got, out.Console)
	}
}

func TestRun_PreRequestHeaderAndURLWriteBack(t *testing.T) {
	req := &collection.Request{
		Method: "GET",
		URL:    &collection.URL{Raw: "https://example.com/old"},
	}
	in := Input{
		Code: `pm.request.headers.add({key: "X-A", value: "1"});
			pm.request.url = "https://example.com/new";`,
		Event:   "prerequest",
		Scope:   newScope(),
		Request: req,
	}
	if _, err := Run(context.Background(), in); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if req.URL == nil || req.URL.Raw != "https://example.com/new" {
		t.Fatalf("request.URL = %+v, want raw https://example.com/new", req.URL)
	}
	found := false
	for _, header := range req.Header {
		if header.Key == "X-A" && header.Value == "1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("request.Header = %+v, want X-A: 1", req.Header)
	}
}

func TestRun_VariablesReplaceInAndPrecedence(t *testing.T) {
	scope := newScope()
	scope.Globals["name"] = "global"
	scope.Environment["name"] = "env"
	scope.Local["name"] = "local"
	in := Input{
		Code: `pm.environment.set("greeting", pm.variables.replaceIn("hello {{name}}"));
			pm.environment.set("narrowest", pm.variables.get("name"));`,
		Event: "test",
		Scope: scope,
	}
	if _, err := Run(context.Background(), in); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := scope.Environment["greeting"]; got != "hello local" {
		t.Fatalf("greeting = %q, want hello local", got)
	}
	if got := scope.Environment["narrowest"]; got != "local" {
		t.Fatalf("narrowest = %q, want local", got)
	}
}

func TestRun_IterationData(t *testing.T) {
	scope := newScope()
	scope.Data["userId"] = "99"
	in := Input{
		Code:  `pm.environment.set("fromData", pm.iterationData.get("userId"));`,
		Event: "test",
		Scope: scope,
	}
	if _, err := Run(context.Background(), in); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := scope.Environment["fromData"]; got != "99" {
		t.Fatalf("fromData = %q, want 99", got)
	}
}

func TestRun_SetNextRequestName(t *testing.T) {
	in := Input{Code: `pm.execution.setNextRequest("Next Step");`, Event: "test", Scope: newScope()}
	out, err := Run(context.Background(), in)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out.NextRequest == nil || *out.NextRequest != "Next Step" {
		t.Fatalf("NextRequest = %v, want Next Step", out.NextRequest)
	}
}

func TestRun_SetNextRequestNull(t *testing.T) {
	in := Input{Code: `postman.setNextRequest(null);`, Event: "test", Scope: newScope()}
	out, err := Run(context.Background(), in)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out.NextRequest == nil || *out.NextRequest != "" {
		t.Fatalf("NextRequest = %v, want empty string pointer", out.NextRequest)
	}
}

func TestRun_SkipRequest(t *testing.T) {
	in := Input{Code: `pm.execution.skipRequest();`, Event: "prerequest", Scope: newScope()}
	out, err := Run(context.Background(), in)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !out.SkipRequest {
		t.Fatalf("SkipRequest = false, want true")
	}
}

func TestRun_SkipRequestIgnoredInTests(t *testing.T) {
	in := Input{Code: `pm.execution.skipRequest();`, Event: "test", Scope: newScope(), Response: fakeResponse(200, "OK", "")}
	out, err := Run(context.Background(), in)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out.SkipRequest {
		t.Fatalf("SkipRequest = true, want false in a test script")
	}
}

func TestRun_ConsoleCapture(t *testing.T) {
	in := Input{Code: `console.log("a", "b", 3); console.warn("careful");`, Event: "test", Scope: newScope()}
	out, err := Run(context.Background(), in)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	want := []string{"log: a b 3", "warn: careful"}
	if len(out.Console) != len(want) {
		t.Fatalf("console = %v, want %v", out.Console, want)
	}
	for i := range want {
		if out.Console[i] != want[i] {
			t.Fatalf("console[%d] = %q, want %q", i, out.Console[i], want[i])
		}
	}
}

func TestRun_LegacyTestsObject(t *testing.T) {
	in := Input{Code: `tests["status is fine"] = true; tests["nope"] = false;`, Event: "test", Scope: newScope()}
	out, err := Run(context.Background(), in)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	byName := map[string]bool{}
	for _, result := range out.Tests {
		byName[result.Name] = result.Passed
	}
	if !byName["status is fine"] {
		t.Fatalf("tests = %+v, want status is fine passing", out.Tests)
	}
	if byName["nope"] {
		t.Fatalf("tests = %+v, want nope failing", out.Tests)
	}
}

func TestRun_RequireUnavailableModule(t *testing.T) {
	in := Input{Code: `require("lodash");`, Event: "test", Scope: newScope()}
	_, err := Run(context.Background(), in)
	if err == nil {
		t.Fatalf("expected an error")
	}
	if !strings.Contains(err.Error(), "require('lodash') is not available in Restly") {
		t.Fatalf("err = %v, want the require('lodash') message", err)
	}
}

func TestRun_SyntaxError(t *testing.T) {
	in := Input{Code: `this is not ) valid javascript (`, Event: "test", Scope: newScope()}
	_, err := Run(context.Background(), in)
	if err == nil {
		t.Fatalf("expected a compile error")
	}
}

func TestRun_TimeoutOnInfiniteLoop(t *testing.T) {
	in := Input{
		Code:    `while (true) {}`,
		Event:   "test",
		Scope:   newScope(),
		Timeout: 200 * time.Millisecond,
	}
	start := time.Now()
	_, err := Run(context.Background(), in)
	elapsed := time.Since(start)
	if err == nil {
		t.Fatalf("expected a timeout error")
	}
	if !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("err = %v, want a timeout message", err)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("Run took %s, want it to return promptly after the timeout", elapsed)
	}
}

func TestRun_TimeoutOnHungSendRequest(t *testing.T) {
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	in := Input{
		Code:    `await pm.sendRequest("https://x.test/hang");`,
		Event:   "test",
		Scope:   newScope(),
		Timeout: 200 * time.Millisecond,
		Send: func(ctx context.Context, req *collection.Request) (*httpx.Response, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		},
	}
	start := time.Now()
	_, err := Run(context.Background(), in)
	elapsed := time.Since(start)
	if err == nil {
		t.Fatalf("expected a timeout error")
	}
	if elapsed > 2*time.Second {
		t.Fatalf("Run took %s, want it to return promptly after the timeout", elapsed)
	}
}

func TestRun_ChaiNotLoadedWithoutExpect(t *testing.T) {
	before := chaiLoadCount.Load()
	in := Input{Code: `pm.environment.set("a", "b");`, Event: "test", Scope: newScope()}
	if _, err := Run(context.Background(), in); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if after := chaiLoadCount.Load(); after != before {
		t.Fatalf("chaiLoadCount changed from %d to %d for a script that never touches pm.expect", before, after)
	}
}

func TestRun_ChaiLoadedWhenExpectUsed(t *testing.T) {
	before := chaiLoadCount.Load()
	in := Input{Code: `pm.expect(1).to.equal(1);`, Event: "test", Scope: newScope()}
	if _, err := Run(context.Background(), in); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if after := chaiLoadCount.Load(); after != before+1 {
		t.Fatalf("chaiLoadCount changed from %d to %d, want exactly +1", before, after)
	}
}

func TestRun_ThrownErrorReturnsPartialOutput(t *testing.T) {
	in := Input{
		Code:  `console.log("before"); throw new Error("boom");`,
		Event: "test",
		Scope: newScope(),
	}
	out, err := Run(context.Background(), in)
	if err == nil {
		t.Fatalf("expected an error")
	}
	if !strings.Contains(err.Error(), "boom") {
		t.Fatalf("err = %v, want it to mention boom", err)
	}
	if !strings.Contains(err.Error(), "script.js:1") {
		t.Fatalf("err = %v, want it to include the throw site's line", err)
	}
	if len(out.Console) != 1 || out.Console[0] != "log: before" {
		t.Fatalf("console = %v, want the line logged before the throw", out.Console)
	}
}

func TestRun_PreRequestWriteBackFailureKeepsOriginalRequest(t *testing.T) {
	req := &collection.Request{Method: "GET", URL: &collection.URL{Raw: "https://example.com"}}
	in := Input{
		Code:    `pm.request.method = 123;`, // a number in a string field breaks the decode
		Event:   "prerequest",
		Scope:   newScope(),
		Request: req,
	}
	_, err := Run(context.Background(), in)
	if err == nil {
		t.Fatalf("expected an error when pm.request.method is not a string")
	}
	if req.Method != "GET" || req.URL == nil || req.URL.Raw != "https://example.com" {
		t.Fatalf("request was wiped out on a failed writeback: %+v", req)
	}
}

func TestRun_AtobBtoa(t *testing.T) {
	in := Input{
		Code: `pm.environment.set("roundTrip", atob(btoa("hi")));
			try { atob("!!!"); } catch (e) { pm.environment.set("badInput", e.message); }`,
		Event: "test",
		Scope: newScope(),
	}
	if _, err := Run(context.Background(), in); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := in.Scope.Environment["roundTrip"]; got != "hi" {
		t.Fatalf("roundTrip = %q, want hi", got)
	}
	if got := in.Scope.Environment["badInput"]; got == "" {
		t.Fatalf("expected atob('!!!') to throw with a message")
	}
}

func TestRun_SendRequestRejectsWithoutSend(t *testing.T) {
	in := Input{
		Code:  `try { await pm.sendRequest("https://x.test"); pm.environment.set("ok", "1"); } catch (e) { pm.environment.set("err", e.message); }`,
		Event: "test",
		Scope: newScope(),
	}
	if _, err := Run(context.Background(), in); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := in.Scope.Environment["err"]; got == "" {
		t.Fatalf("expected pm.sendRequest to reject when Send is nil")
	}
}

func TestRun_CryptoJSSHA256(t *testing.T) {
	in := Input{
		Code:  `pm.environment.set("hash", CryptoJS.SHA256("abc").toString());`,
		Event: "test",
		Scope: newScope(),
	}
	if _, err := Run(context.Background(), in); err != nil {
		t.Fatalf("Run: %v", err)
	}
	sum := sha256.Sum256([]byte("abc"))
	want := hex.EncodeToString(sum[:])
	if got := in.Scope.Environment["hash"]; got != want {
		t.Fatalf("hash = %q, want %q", got, want)
	}
}

// TestRun_CryptoJSPostmanLoginPattern mirrors the user's imported Postman login pre-request
// scripts: CryptoJS.SHA256 over globals, stored back with postman.setGlobalVariable. The
// stored value must be the hex string, not a WordArray dumped as JSON.
func TestRun_CryptoJSPostmanLoginPattern(t *testing.T) {
	scope := newScope()
	scope.Globals["PASSWORD"] = "hunter2"
	scope.Globals["USER_ID"] = "u1"
	scope.Globals["VC_CODE"] = "vc9"
	in := Input{
		Code: `var token = CryptoJS.SHA256(postman.getGlobalVariable("PASSWORD"));
			postman.setGlobalVariable("PASS", token);
			var vc_str = postman.getGlobalVariable("USER_ID") + "|" +
			postman.getGlobalVariable("VC_CODE");
			var vc_code =  CryptoJS.SHA256(vc_str);
			postman.setGlobalVariable("vc", vc_code);`,
		Event: "prerequest",
		Scope: scope,
	}
	if _, err := Run(context.Background(), in); err != nil {
		t.Fatalf("Run: %v", err)
	}
	passSum := sha256.Sum256([]byte("hunter2"))
	wantPass := hex.EncodeToString(passSum[:])
	vcSum := sha256.Sum256([]byte("u1|vc9"))
	wantVC := hex.EncodeToString(vcSum[:])
	if got := scope.Globals["PASS"]; got != wantPass {
		t.Fatalf("Globals[PASS] = %q, want %q (a WordArray must stringify to its hex form, not [object Object])", got, wantPass)
	}
	if got := scope.Globals["vc"]; got != wantVC {
		t.Fatalf("Globals[vc] = %q, want %q", got, wantVC)
	}
}

func TestRun_CryptoJSRequireHmacBase64(t *testing.T) {
	in := Input{
		Code:  `pm.environment.set("mac", require("crypto-js").HmacSHA256("msg", "key").toString(require("crypto-js").enc.Base64));`,
		Event: "test",
		Scope: newScope(),
	}
	if _, err := Run(context.Background(), in); err != nil {
		t.Fatalf("Run: %v", err)
	}
	mac := hmac.New(sha256.New, []byte("key"))
	mac.Write([]byte("msg"))
	want := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if got := in.Scope.Environment["mac"]; got != want {
		t.Fatalf("mac = %q, want %q", got, want)
	}
}

// TestRun_CryptoJSRandomAndAESRoundTrip covers WordArray.random and AES.encrypt/decrypt with
// a passphrase, both of which need crypto-js's secure-random path to work (see crypto.
// getRandomValues in helpers.go). If this fails, WordArray.random has no working entropy
// source in this runtime and AES passphrase encryption is unsupported.
func TestRun_CryptoJSRandomAndAESRoundTrip(t *testing.T) {
	in := Input{
		Code: `var wa = CryptoJS.lib.WordArray.random(16);
			pm.environment.set("sigBytes", String(wa.sigBytes));
			var enc = CryptoJS.AES.encrypt("hello world", "pass123").toString();
			var dec = CryptoJS.AES.decrypt(enc, "pass123").toString(CryptoJS.enc.Utf8);
			pm.environment.set("roundTrip", dec);`,
		Event: "test",
		Scope: newScope(),
	}
	out, err := Run(context.Background(), in)
	if err != nil {
		t.Fatalf("Run: %v (console: %v)", err, out.Console)
	}
	if got := in.Scope.Environment["sigBytes"]; got != "16" {
		t.Fatalf("sigBytes = %q, want 16", got)
	}
	if got := in.Scope.Environment["roundTrip"]; got != "hello world" {
		t.Fatalf("roundTrip = %q, want hello world", got)
	}
}

func TestRun_CryptoJSNotLoadedWithoutUse(t *testing.T) {
	before := cryptoJSLoadCount.Load()
	in := Input{Code: `pm.environment.set("a", "b");`, Event: "test", Scope: newScope()}
	if _, err := Run(context.Background(), in); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if after := cryptoJSLoadCount.Load(); after != before {
		t.Fatalf("cryptoJSLoadCount changed from %d to %d for a script that never touches CryptoJS", before, after)
	}
}

func TestRun_CryptoJSLoadedWhenUsed(t *testing.T) {
	before := cryptoJSLoadCount.Load()
	in := Input{Code: `CryptoJS.SHA256("x").toString();`, Event: "test", Scope: newScope()}
	if _, err := Run(context.Background(), in); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if after := cryptoJSLoadCount.Load(); after != before+1 {
		t.Fatalf("cryptoJSLoadCount changed from %d to %d, want exactly +1", before, after)
	}
}

func TestRun_PreRequestHeaderAddUpsertRemove(t *testing.T) {
	req := &collection.Request{
		Method: "GET",
		URL:    &collection.URL{Raw: "https://example.com"},
		Header: []collection.KV{{Key: "X-Old", Value: "old"}, {Key: "X-Obj", Value: "old"}},
	}
	in := Input{
		Code: `pm.request.addHeader({key: "X-Test", value: "1"});
			pm.request.upsertHeader({key: "X-Test", value: "2"});
			pm.request.removeHeader("X-Old");
			pm.request.removeHeader({key: "X-Obj"});`,
		Event:   "prerequest",
		Scope:   newScope(),
		Request: req,
	}
	if _, err := Run(context.Background(), in); err != nil {
		t.Fatalf("Run: %v", err)
	}
	byKey := map[string]string{}
	for _, header := range req.Header {
		byKey[header.Key] = header.Value
	}
	if byKey["X-Old"] != "" {
		t.Fatalf("request.Header = %+v, want X-Old removed", req.Header)
	}
	if _, stillThere := byKey["X-Obj"]; stillThere {
		t.Fatalf("request.Header = %+v, want X-Obj removed via the {key: ...} form", req.Header)
	}
	if byKey["X-Test"] != "2" {
		t.Fatalf("request.Header = %+v, want X-Test upserted to 2", req.Header)
	}
}

// scriptNode is one collection/folder/request event holder to run scripts for.
type scriptNode struct {
	name   string
	events []collection.Event
	req    *collection.Request // nil for the collection itself and for folders
}

// collectScriptNodes walks a loaded collection the way runner.Exec's chain does, but flattened
// into every collection/folder/request node instead of just one item's ancestor chain.
func collectScriptNodes(coll *collection.Collection) []scriptNode {
	nodes := []scriptNode{{name: coll.Info.Name, events: coll.Event}}
	var walk func(items []*collection.Item)
	walk = func(items []*collection.Item) {
		for _, item := range items {
			nodes = append(nodes, scriptNode{name: item.Name, events: item.Event, req: item.Request})
			if item.IsFolder() {
				walk(item.Item)
			}
		}
	}
	walk(coll.Item)
	return nodes
}

// cloneCollectionRequest mirrors runner.cloneRequest (internal/runner/helpers.go), unexported
// there, so a pre-request script's write-back never touches the loaded collection in place.
func cloneCollectionRequest(req *collection.Request) (*collection.Request, error) {
	if req == nil {
		return nil, nil
	}
	data, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	var clone collection.Request
	if err := json.Unmarshal(data, &clone); err != nil {
		return nil, err
	}
	return &clone, nil
}

// TestRealCollectionScriptsRun runs every pre-request and test script from the user's real,
// imported Postman collections through Run, read-only (RESTLY_REAL_COLLECTIONS lists files;
// see TestRoundTripRealCollections in internal/collection for the same env var convention).
// It never calls LoadCollection's result back through SaveCollection, and configures no Send
// function, so pm.sendRequest only ever rejects locally instead of reaching the network.
//
// A script failing an assertion against the fake response, or hitting the no-Send rejection,
// is expected and only logged. Only errors that mean Restly is missing part of the scripted
// API (a ReferenceError, "is not a function", or "is not available in Restly") are real
// failures worth failing the test over.
//
// "Cannot read property" is the odd one out: a pre-request script has no response to read, so
// that error there really does mean some pm/CryptoJS surface came back undefined. A test
// script, though, almost always throws it just by walking into a field the canned {} response
// body does not have (e.g. pm.response.json().data.token) - an expected assertion failure in
// substance, even though its message matches the same "missing API" string. So this pattern is
// only treated as fatal for prerequest scripts; for test scripts it is logged like any other
// assertion failure.
func TestRealCollectionScriptsRun(t *testing.T) {
	paths := filepath.SplitList(os.Getenv("RESTLY_REAL_COLLECTIONS"))
	if len(paths) == 0 {
		t.Skip("RESTLY_REAL_COLLECTIONS is not set")
	}
	alwaysFatal := []string{"ReferenceError", "is not a function", "is not available in Restly"}
	const prerequestOnlyFatal = "Cannot read property"

	for _, path := range paths {
		if path == "" {
			continue // a trailing separator in the env var splits into one empty path
		}
		coll, err := collection.LoadCollection(path)
		if err != nil {
			// One stray non-collection file (e.g. an environment export matched by a broad
			// glob) should not hide every result for the files sorted after it.
			t.Errorf("failed to load %s: %v", path, err)
			continue
		}
		var ran, failed int
		for _, node := range collectScriptNodes(coll) {
			req, err := cloneCollectionRequest(node.req)
			if err != nil {
				t.Errorf("%s: %s: failed to clone request: %v", path, node.name, err)
				continue
			}
			for _, listen := range []string{"prerequest", "test"} {
				code := collection.Code(node.events, listen)
				if code == "" {
					continue
				}
				in := Input{
					Code:    code,
					Event:   listen,
					Scope:   newScope(),
					Request: req,
				}
				if listen == "test" {
					in.Response = fakeResponse(200, "OK", "{}", httpx.Header{Key: "Content-Type", Value: "application/json"})
				}
				ran++
				if _, err := Run(context.Background(), in); err != nil {
					isMissingAPI := false
					for _, pattern := range alwaysFatal {
						if strings.Contains(err.Error(), pattern) {
							isMissingAPI = true
							break
						}
					}
					if !isMissingAPI && listen == "prerequest" && strings.Contains(err.Error(), prerequestOnlyFatal) {
						isMissingAPI = true
					}
					if isMissingAPI {
						failed++
						t.Errorf("%s: %q %s script hit a missing API: %v", path, node.name, listen, err)
					} else {
						t.Logf("%s: %q %s script: %v", path, node.name, listen, err)
					}
				}
			}
		}
		t.Logf("%s: ran %d scripts, %d failed on a missing API", path, ran, failed)
	}
}

// BenchmarkRunNoChai excludes network and chai: a trivial script that only touches variable
// scopes, representing the common case Run's 5ms-without-chai budget is measured against.
func BenchmarkRunNoChai(b *testing.B) {
	in := Input{Code: `pm.environment.set("a", "b");`, Event: "test", Scope: newScope()}
	b.ReportAllocs()
	for b.Loop() {
		if _, err := Run(context.Background(), in); err != nil {
			b.Fatalf("Run: %v", err)
		}
	}
}

// BenchmarkRunWithChai excludes network: one pm.expect assertion, forcing chai to load on
// every run (each Run gets a fresh runtime, so the lazy load cost is paid every time).
func BenchmarkRunWithChai(b *testing.B) {
	in := Input{Code: `pm.expect(1).to.equal(1);`, Event: "test", Scope: newScope()}
	b.ReportAllocs()
	for b.Loop() {
		if _, err := Run(context.Background(), in); err != nil {
			b.Fatalf("Run: %v", err)
		}
	}
}
