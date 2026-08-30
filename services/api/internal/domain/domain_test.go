package domain

import "testing"

func TestStatusTransitions(t *testing.T) {
	cases := []struct {
		from, to string
		ok       bool
	}{
		{"todo", "in_progress", true}, {"in_progress", "done", true},
		{"done", "todo", false}, {"blocked", "done", false},
		{"done", "done", true},
	}
	for _, tc := range cases {
		err := ValidateTransition(tc.from, tc.to)
		if (err == nil) != tc.ok {
			t.Fatalf("%s -> %s: got err=%v", tc.from, tc.to, err)
		}
	}
}
