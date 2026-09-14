package script

import (
	"context"
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
