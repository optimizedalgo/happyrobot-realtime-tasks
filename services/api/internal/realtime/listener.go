package realtime

import (
	"context"
	"log"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"happyrobot/api/internal/domain"
)

func Listen(ctx context.Context, databaseURL string, broker *Broker) {
	for ctx.Err() == nil {
		conn, err := pgx.Connect(ctx, databaseURL)
		if err != nil {
			log.Printf("realtime connect: %v", err)
			sleep(ctx)
			continue
		}
		if _, err := conn.Exec(ctx, "LISTEN task_events"); err != nil {
			_ = conn.Close(ctx)
			sleep(ctx)
			continue
		}
		log.Printf("realtime listener connected")
		for ctx.Err() == nil {
			n, err := conn.WaitForNotification(ctx)
			if err != nil {
				break
			}
			id, err := strconv.ParseInt(n.Payload, 10, 64)
			if err != nil {
				continue
			}
			var evt domain.Event
			err = conn.QueryRow(ctx, `SELECT id, project_id::text, event_type, entity_type, entity_id::text, payload, created_at::text FROM event_log WHERE id=$1`, id).
				Scan(&evt.ID, &evt.ProjectID, &evt.EventType, &evt.EntityType, &evt.EntityID, &evt.Payload, &evt.CreatedAt)
			if err == nil {
				broker.Publish(evt)
			}
		}
		_ = conn.Close(context.Background())
		sleep(ctx)
	}
}

func sleep(ctx context.Context) {
	select {
	case <-time.After(time.Second):
	case <-ctx.Done():
	}
}
