# Restly

Wails v2 desktop app: Go backend at the repo root, React 19 + TypeScript + CodeMirror 6 frontend in `frontend/`.

- Design decisions live in `docs/spec/`, one file per feature, indexed in `docs/spec/README.md` (D1, D2, ...). Read only the file for the feature you are changing, and add or amend its decision when you change behavior. A new feature gets its own file and a row in the index.
- New or updated docs go directly in `docs/`, not in skill-specific folders such as `docs/superpowers/`.
- Every UI change follows `docs/ui-guidelines.md`. Run its section 8 checklist before calling a UI change done, including the screenshot loop.
- Gates before finishing any change:
  - `cd frontend && npx tsc --noEmit -p . && npm run build`
  - `for c in frontend/checks/*.check.ts; do node "$c"; done` from the repo root
  - `go vet ./... && go test ./...`
- Run the app only against a throwaway home: `HOME=/tmp/restly-home wails dev -browser=false`. Never point it at the real `~/Restly`.
