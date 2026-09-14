package runner

import (
	"context"
	"fmt"

	"restly/internal/collection"
	"restly/internal/httpx"
	"restly/internal/script"
	"restly/internal/vars"
)

// Exec runs the pre-request scripts, sends the request, and runs the test scripts, each in
// Postman's order: collection, folders, request. Scripts change scope in place.
func Exec(ctx context.Context, client *httpx.Client, scope *vars.Scope, step Step) *Outcome {
	outcome := &Outcome{}
	req, err := cloneRequest(step.Item)
	if err != nil {
		outcome.Err = err
		return outcome
	}
	// Local variables live for one request in Postman.
	scope.Local = map[string]string{}

	chain := make([][]collection.Event, 0, len(step.Ancestors)+2)
	chain = append(chain, step.Collection.Event)
	for _, folder := range step.Ancestors {
		chain = append(chain, folder.Event)
	}
	chain = append(chain, step.Item.Event)

	input := script.Input{
		Scope:   scope,
		Request: req,
		Info:    step.Info,
		Send: func(ctx context.Context, sub *collection.Request) (*httpx.Response, error) {
			// Postman does not substitute variables here, and reading scope would race with the script.
			prep, err := httpx.Resolve(sub, nil, vars.New())
			if err != nil {
				return nil, err
			}
			return client.Send(ctx, prep)
		},
	}
	if !outcome.runScripts(ctx, chain, "prerequest", input) {
		return outcome
	}

	prep, err := httpx.Resolve(req, EffectiveAuth(step.Collection, step.Ancestors, req), scope)
	if err != nil {
		outcome.Err = fmt.Errorf("failed to build request: %w", err)
		return outcome
	}
	outcome.Prepared = prep
	resp, err := client.Send(ctx, prep)
	if err != nil {
		outcome.Err = err
		return outcome
	}
	outcome.Response = resp

	input.Response = resp
	outcome.runScripts(ctx, chain, "test", input)
	return outcome
}

// runScripts runs the listen scripts in order and reports whether the request should go on.
func (outcome *Outcome) runScripts(ctx context.Context, chain [][]collection.Event, listen string, input script.Input) bool {
	input.Event = listen
	for _, events := range chain {
		input.Code = collection.Code(events, listen)
		if input.Code == "" {
			continue
		}
		out, err := script.Run(ctx, input)
		if out != nil {
			outcome.Tests = append(outcome.Tests, out.Tests...)
			outcome.Console = append(outcome.Console, out.Console...)
			if out.NextRequest != nil {
				outcome.NextRequest = out.NextRequest
			}
			outcome.Skipped = outcome.Skipped || (listen == "prerequest" && out.SkipRequest)
		}
		if err != nil {
			outcome.Err = fmt.Errorf("%s script failed: %w", listen, err)
			return false
		}
		if outcome.Skipped {
			return false
		}
	}
	return true
}

// Run executes every request under folder, or the whole collection when folder is empty,
// for each iteration, and reports each result through emit as it finishes.
func Run(
	ctx context.Context,
	client *httpx.Client,
	scope *vars.Scope,
	coll *collection.Collection,
	folder []int,
	opts Options,
	emit func(Result),
) Summary {
	var summary Summary
	entries, err := flatten(coll, folder)
	if err != nil {
		summary.add(Result{Error: err.Error()})
		emit(Result{Error: err.Error()})
		return summary
	}
	iterations := max(opts.Iterations, 1)
	for iteration := range iterations {
		for index := 0; index < len(entries); {
			if ctx.Err() != nil {
				summary.Stopped = true
				return summary
			}
			current := entries[index]
			outcome := Exec(ctx, client, scope, Step{
				Collection: coll,
				Ancestors:  current.ancestors,
				Item:       current.item,
				Info: script.Info{
					RequestName:    current.item.Name,
					Iteration:      iteration,
					IterationCount: iterations,
				},
			})
			result := newResult(iteration, current, outcome)
			summary.add(result)
			emit(result)

			next, stop := nextIndex(entries, index, outcome.NextRequest)
			if stop {
				return summary
			}
			index = next
			if opts.Delay > 0 && !sleep(ctx, opts.Delay) {
				summary.Stopped = true
				return summary
			}
		}
	}
	return summary
}
