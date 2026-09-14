// Package script runs Postman pre-request and test scripts in goja with a pm API shim.
package script

import (
	"context"
	"time"

	"restly/internal/collection"
	"restly/internal/httpx"
	"restly/internal/vars"
)

type Info struct {
	RequestName    string `json:"requestName"`
	Iteration      int    `json:"iteration"`
	IterationCount int    `json:"iterationCount"`
}

type Input struct {
	Code     string
	Event    string              // "prerequest" or "test"
	Scope    *vars.Scope         // scripts change it in place
	Request  *collection.Request // pre-request scripts may change it in place
	Response *httpx.Response     // nil for pre-request scripts
	Info     Info
	// Send backs pm.sendRequest. The request has not had variables substituted.
	Send    func(ctx context.Context, req *collection.Request) (*httpx.Response, error)
	Timeout time.Duration // zero means DefaultTimeout
}

type TestResult struct {
	Name   string `json:"name"`
	Passed bool   `json:"passed"`
	Error  string `json:"error"`
}

type Output struct {
	Tests   []TestResult `json:"tests"`
	Console []string     `json:"console"`
	// NextRequest is nil unless the script called setNextRequest. An empty name stops the run.
	NextRequest *string `json:"nextRequest"`
	SkipRequest bool    `json:"skipRequest"`
}
