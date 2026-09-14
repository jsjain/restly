package collection

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// syntheticCollection builds a collection of about sizeBytes with realistic requests: headers,
// a JSON body, a test script, and a saved example response.
func syntheticCollection(sizeBytes int) []byte {
	const item = `{"name":"Request %d","request":{"method":"POST","header":[{"key":"Content-Type","value":"application/json"},` +
		`{"key":"Authorization","value":"Bearer {{token}}"}],"body":{"mode":"raw","raw":"{\n  \"id\": %d,\n  \"name\": \"example\"\n}",` +
		`"options":{"raw":{"language":"json"}}},"url":{"raw":"{{base}}/api/v1/items/%d","host":["{{base}}"],"path":["api","v1","items","%d"]}},` +
		`"event":[{"listen":"test","script":{"type":"text/javascript","exec":["pm.test('ok', () => pm.response.to.have.status(200));"]}}],` +
		`"response":[{"name":"ok","code":200,"body":"{\"id\": %d}"}]}`
	var builder strings.Builder
	builder.WriteString(`{"info":{"name":"bench","schema":"` + SchemaV21 + `"},"item":[`)
	for i := 0; builder.Len() < sizeBytes; i++ {
		if i > 0 {
			builder.WriteByte(',')
		}
		fmt.Fprintf(&builder, item, i, i, i, i, i)
	}
	builder.WriteString(`]}`)
	return []byte(builder.String())
}

// BenchmarkLoadSave5MB measures reading and writing a 5 MB collection file.
// It excludes the webview transfer and rendering, which the design target D9 also covers.
func BenchmarkLoadSave5MB(b *testing.B) {
	dir := b.TempDir()
	path := filepath.Join(dir, "bench.json")
	if err := os.WriteFile(path, syntheticCollection(5<<20), 0o600); err != nil {
		b.Fatalf("failed to write fixture: %v", err)
	}
	for b.Loop() {
		coll, err := LoadCollection(path)
		if err != nil {
			b.Fatalf("load failed: %v", err)
		}
		if err := SaveCollection(filepath.Join(dir, "out.json"), coll); err != nil {
			b.Fatalf("save failed: %v", err)
		}
	}
}

// BenchmarkLoad5MB measures only reading a 5 MB collection file.
func BenchmarkLoad5MB(b *testing.B) {
	path := filepath.Join(b.TempDir(), "bench.json")
	if err := os.WriteFile(path, syntheticCollection(5<<20), 0o600); err != nil {
		b.Fatalf("failed to write fixture: %v", err)
	}
	for b.Loop() {
		if _, err := LoadCollection(path); err != nil {
			b.Fatalf("load failed: %v", err)
		}
	}
}
