package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	apihttp "happyrobot/api/internal/api"
	"happyrobot/api/internal/db"
	"happyrobot/api/internal/realtime"
)

func main() {
	databaseURL := env("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/happyrobot?sslmode=disable")
	realtimeDatabaseURL := env("REALTIME_DATABASE_URL", databaseURL)
	port := env("PORT", "8080")
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	pool, err := db.Open(ctx, databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	if env("AUTO_MIGRATE", "true") == "true" {
		if err := db.Migrate(ctx, pool); err != nil {
			log.Fatalf("migrate: %v", err)
		}
	}
	broker := realtime.New()
	go realtime.Listen(ctx, realtimeDatabaseURL, broker)
	srv := &http.Server{Addr: ":" + port, Handler: (&apihttp.Server{DB: pool, Broker: broker, CORSOrigin: env("CORS_ORIGIN", "http://localhost:3000,http://127.0.0.1:3000")}).Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		log.Printf("api listening on http://localhost:%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = srv.Shutdown(shutdownCtx)
}
func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
