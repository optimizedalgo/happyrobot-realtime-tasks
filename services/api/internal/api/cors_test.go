package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMatchAllowedOrigin(t *testing.T) {
	allowed := "http://localhost:3000,http://127.0.0.1:3000"
	for _, origin := range []string{"http://localhost:3000", "http://127.0.0.1:3000"} {
		if got := matchAllowedOrigin(origin, allowed); got != origin {
			t.Fatalf("expected %q to be allowed, got %q", origin, got)
		}
	}
	if got := matchAllowedOrigin("http://evil.example", allowed); got != "" {
		t.Fatalf("expected disallowed origin to return empty string, got %q", got)
	}
}

func TestCORSPreflightAllowlist(t *testing.T) {
	s := &Server{CORSOrigin: "http://localhost:3000,http://127.0.0.1:3000"}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	})
	handler := s.cors(next)

	req := httptest.NewRequest(http.MethodOptions, "/api/projects", nil)
	req.Header.Set("Origin", "http://127.0.0.1:3000")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:3000" {
		t.Fatalf("unexpected allow-origin header: %q", got)
	}

	badReq := httptest.NewRequest(http.MethodOptions, "/api/projects", nil)
	badReq.Header.Set("Origin", "http://evil.example")
	badRec := httptest.NewRecorder()
	handler.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for disallowed origin, got %d", badRec.Code)
	}
}
