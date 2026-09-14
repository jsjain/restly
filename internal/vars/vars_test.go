package vars

import (
	"regexp"
	"testing"
)

func TestReplace(t *testing.T) {
	scope := New()
	scope.Globals["host"] = "global.test"
	scope.Environment["host"] = "env.test"
	scope.Environment["base"] = "https://{{host}}/v1"
	scope.Local["self"] = "{{self}}"

	cases := []struct {
		name string
		in   string
		want string
	}{
		{name: "narrowest scope wins", in: "{{host}}", want: "env.test"},
		{name: "nested reference", in: "{{base}}/users", want: "https://env.test/v1/users"},
		{name: "unknown kept", in: "{{missing}}", want: "{{missing}}"},
		{name: "self reference stops", in: "{{self}}", want: "{{self}}"},
	}
	for _, tc := range cases {
		if got := scope.Replace(tc.in); got != tc.want {
			t.Errorf("%s: Replace(%q) = %q, want %q", tc.name, tc.in, got, tc.want)
		}
	}

	guid := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	if got := scope.Replace("{{$guid}}"); !guid.MatchString(got) {
		t.Errorf("Replace({{$guid}}) = %q, want a v4 UUID", got)
	}
}
