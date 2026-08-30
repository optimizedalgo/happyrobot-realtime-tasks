package domain

import (
	"errors"
	"fmt"
)

type Project struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Metadata    map[string]any `json:"metadata"`
	Version     int            `json:"version"`
	CreatedAt   string         `json:"createdAt"`
	UpdatedAt   string         `json:"updatedAt"`
}

type Configuration struct {
	Priority     string         `json:"priority"`
	Description  string         `json:"description"`
	Tags         []string       `json:"tags"`
	CustomFields map[string]any `json:"customFields"`
}

type Task struct {
	ID            string        `json:"id"`
	ProjectID     string        `json:"projectId"`
	Title         string        `json:"title"`
	Status        string        `json:"status"`
	AssignedTo    []string      `json:"assignedTo"`
	Configuration Configuration `json:"configuration"`
	Dependencies  []string      `json:"dependencies"`
	Version       int           `json:"version"`
	CreatedAt     string        `json:"createdAt"`
	UpdatedAt     string        `json:"updatedAt"`
}

type Comment struct {
	ID        string `json:"id"`
	TaskID    string `json:"taskId"`
	Content   string `json:"content"`
	Author    string `json:"author"`
	Timestamp string `json:"timestamp"`
}

type Event struct {
	ID         int64  `json:"id"`
	ProjectID  string `json:"projectId"`
	EventType  string `json:"eventType"`
	EntityType string `json:"entityType"`
	EntityID   string `json:"entityId"`
	Payload    []byte `json:"-"`
	CreatedAt  string `json:"createdAt"`
}

var allowed = map[string]map[string]bool{
	"todo":        {"in_progress": true, "blocked": true, "done": true},
	"in_progress": {"todo": true, "blocked": true, "done": true},
	"blocked":     {"todo": true, "in_progress": true},
	"done":        {"in_progress": true},
}

func ValidateTransition(from, to string) error {
	if from == to {
		return nil
	}
	if allowed[from][to] {
		return nil
	}
	return fmt.Errorf("invalid status transition %s -> %s", from, to)
}

func ValidateStatus(status string) error {
	switch status {
	case "todo", "in_progress", "blocked", "done":
		return nil
	default:
		return errors.New("status must be todo, in_progress, blocked, or done")
	}
}

func ValidatePriority(priority string) error {
	switch priority {
	case "low", "medium", "high", "urgent":
		return nil
	default:
		return errors.New("priority must be low, medium, high, or urgent")
	}
}
