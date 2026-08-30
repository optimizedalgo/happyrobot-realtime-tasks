package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"happyrobot/api/internal/domain"
	"happyrobot/api/internal/realtime"
)

type Server struct {
	DB         *pgxpool.Pool
	Broker     *realtime.Broker
	CORSOrigin string
}

type taskRow struct {
	Task      domain.Task
	ConfigRaw []byte
	Created   time.Time
	Updated   time.Time
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /api/projects", s.listProjects)
	mux.HandleFunc("POST /api/projects", s.createProject)
	mux.HandleFunc("GET /api/projects/{projectId}", s.getProject)
	mux.HandleFunc("PATCH /api/projects/{projectId}", s.updateProject)
	mux.HandleFunc("GET /api/projects/{projectId}/tasks", s.listTasks)
	mux.HandleFunc("POST /api/projects/{projectId}/tasks", s.createTask)
	mux.HandleFunc("PATCH /api/tasks/{taskId}", s.updateTask)
	mux.HandleFunc("DELETE /api/tasks/{taskId}", s.deleteTask)
	mux.HandleFunc("GET /api/tasks/{taskId}/comments", s.listComments)
	mux.HandleFunc("POST /api/tasks/{taskId}/comments", s.createComment)
	mux.HandleFunc("GET /api/events", s.events)
	mux.HandleFunc("GET /api/project-events", s.projectEvents)
	mux.HandleFunc("GET /api/event-deltas", s.eventDeltas)
	return s.cors(s.logging(mux))
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		configured := s.CORSOrigin
		if configured == "" {
			configured = "http://localhost:3000,http://127.0.0.1:3000"
		}

		requestOrigin := strings.TrimSpace(r.Header.Get("Origin"))
		allowedOrigin := matchAllowedOrigin(requestOrigin, configured)
		if allowedOrigin != "" {
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		}
		w.Header().Add("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, If-Match, Last-Event-ID")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")

		if r.Method == http.MethodOptions {
			if requestOrigin != "" && allowedOrigin == "" {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func matchAllowedOrigin(requestOrigin, configured string) string {
	if requestOrigin == "" {
		return ""
	}
	for _, raw := range strings.Split(configured, ",") {
		candidate := strings.TrimSpace(raw)
		if candidate == "*" {
			return "*"
		}
		if candidate == requestOrigin {
			return requestOrigin
		}
	}
	return ""
}
func (s *Server) logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if err := s.DB.Ping(r.Context()); err != nil {
		jsonOut(w, 503, map[string]string{"status": "degraded", "database": "unreachable"})
		return
	}
	jsonOut(w, 200, map[string]string{"status": "ok", "database": "ok"})
}

func scanProject(row pgx.Row, includeMetadata bool) (domain.Project, error) {
	var p domain.Project
	var raw []byte
	var created, updated time.Time
	var err error
	if includeMetadata {
		err = row.Scan(&p.ID, &p.Name, &p.Description, &raw, &p.Version, &created, &updated)
	} else {
		err = row.Scan(&p.ID, &p.Name, &p.Description, &p.Version, &created, &updated)
	}
	if err != nil {
		return p, err
	}
	p.Metadata = map[string]any{}
	if includeMetadata && len(raw) > 0 {
		_ = json.Unmarshal(raw, &p.Metadata)
		if p.Metadata == nil {
			p.Metadata = map[string]any{}
		}
	}
	p.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	p.UpdatedAt = updated.UTC().Format(time.RFC3339Nano)
	return p, nil
}

func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	// Deliberately project only lightweight fields. Project metadata may grow to MBs.
	var syncCursor int64
	if err := s.DB.QueryRow(r.Context(), `SELECT COALESCE(max(id),0) FROM event_log WHERE entity_type='project'`).Scan(&syncCursor); err != nil {
		fail(w, 500, err.Error())
		return
	}
	rows, err := s.DB.Query(r.Context(), `SELECT id::text,name,description,version,created_at,updated_at FROM projects ORDER BY created_at DESC`)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []domain.Project{}
	for rows.Next() {
		p, err := scanProject(rows, false)
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		out = append(out, p)
	}
	jsonOut(w, 200, map[string]any{"items": out, "syncCursor": syncCursor})
}

func (s *Server) getProject(w http.ResponseWriter, r *http.Request) {
	p, err := scanProject(s.DB.QueryRow(r.Context(), `SELECT id::text,name,description,metadata,version,created_at,updated_at FROM projects WHERE id=$1`, r.PathValue("projectId")), true)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "project not found")
		return
	}
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	jsonOut(w, 200, p)
}

func (s *Server) createProject(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string         `json:"name"`
		Description string         `json:"description"`
		Metadata    map[string]any `json:"metadata"`
	}
	if err := decode(r, &in); err != nil {
		fail(w, 400, err.Error())
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		fail(w, 400, "name is required")
		return
	}
	if in.Metadata == nil {
		in.Metadata = map[string]any{}
	}
	raw, _ := json.Marshal(in.Metadata)
	tx, err := s.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	p, err := scanProject(tx.QueryRow(r.Context(), `INSERT INTO projects(name,description,metadata) VALUES($1,$2,$3) RETURNING id::text,name,description,metadata,version,created_at,updated_at`, in.Name, in.Description, raw), true)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	if _, err := insertEvent(r.Context(), tx, p.ID, "project.created", "project", p.ID, p); err != nil {
		fail(w, 500, err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		fail(w, 500, err.Error())
		return
	}
	jsonOut(w, 201, p)
}

func (s *Server) updateProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("projectId")
	var in struct {
		Name        *string         `json:"name"`
		Description *string         `json:"description"`
		Metadata    *map[string]any `json:"metadata"`
		Version     int             `json:"version"`
	}
	if err := decode(r, &in); err != nil {
		fail(w, 400, err.Error())
		return
	}
	if in.Version < 1 {
		fail(w, 400, "version is required for optimistic concurrency")
		return
	}
	tx, err := s.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	current, err := scanProject(tx.QueryRow(r.Context(), `SELECT id::text,name,description,metadata,version,created_at,updated_at FROM projects WHERE id=$1 FOR UPDATE`, id), true)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "project not found")
		return
	}
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	if current.Version != in.Version {
		jsonOut(w, 409, map[string]any{"error": "version conflict", "current": current})
		return
	}
	next := current
	if in.Name != nil {
		next.Name = strings.TrimSpace(*in.Name)
		if next.Name == "" {
			fail(w, 400, "name cannot be empty")
			return
		}
	}
	if in.Description != nil {
		next.Description = strings.TrimSpace(*in.Description)
	}
	if in.Metadata != nil {
		next.Metadata = *in.Metadata
		if next.Metadata == nil {
			next.Metadata = map[string]any{}
		}
	}
	raw, _ := json.Marshal(next.Metadata)
	next, err = scanProject(tx.QueryRow(r.Context(), `UPDATE projects SET name=$2,description=$3,metadata=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING id::text,name,description,metadata,version,created_at,updated_at`, id, next.Name, next.Description, raw), true)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	if _, err := insertEvent(r.Context(), tx, id, "project.updated", "project", id, map[string]any{"project": next, "previousVersion": current.Version}); err != nil {
		fail(w, 500, err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		fail(w, 500, err.Error())
		return
	}
	jsonOut(w, 200, next)
}

type cursor struct {
	T  time.Time
	ID string
}

func encodeCursor(t time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(t.UTC().Format(time.RFC3339Nano) + "|" + id))
}
func decodeCursor(v string) (cursor, error) {
	b, e := base64.RawURLEncoding.DecodeString(v)
	if e != nil {
		return cursor{}, e
	}
	parts := strings.SplitN(string(b), "|", 2)
	if len(parts) != 2 {
		return cursor{}, errors.New("bad cursor")
	}
	t, e := time.Parse(time.RFC3339Nano, parts[0])
	return cursor{t, parts[1]}, e
}

func scanTask(row pgx.Row) (domain.Task, time.Time, error) {
	var t domain.Task
	var cfg []byte
	var created, updated time.Time
	err := row.Scan(&t.ID, &t.ProjectID, &t.Title, &t.Status, &t.AssignedTo, &cfg, &t.Dependencies, &t.Version, &created, &updated)
	if err != nil {
		return t, created, err
	}
	_ = json.Unmarshal(cfg, &t.Configuration)
	t.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	t.UpdatedAt = updated.UTC().Format(time.RFC3339Nano)
	return t, created, nil
}

func (s *Server) listTasks(w http.ResponseWriter, r *http.Request) {
	pid := r.PathValue("projectId")
	var syncCursor int64
	if err := s.DB.QueryRow(r.Context(), `SELECT COALESCE(max(id),0) FROM event_log WHERE project_id=$1`, pid).Scan(&syncCursor); err != nil {
		fail(w, 500, err.Error())
		return
	}
	limit := 100
	if q := r.URL.Query().Get("limit"); q != "" {
		if n, e := strconv.Atoi(q); e == nil && n > 0 && n <= 250 {
			limit = n
		}
	}
	status := r.URL.Query().Get("status")
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	args := []any{pid, limit + 1}
	where := `project_id=$1`
	idx := 3
	if status != "" {
		if err := domain.ValidateStatus(status); err != nil {
			fail(w, 400, err.Error())
			return
		}
		where += fmt.Sprintf(" AND status=$%d", idx)
		args = append(args, status)
		idx++
	}
	if search != "" {
		where += fmt.Sprintf(" AND title ILIKE $%d", idx)
		args = append(args, "%"+search+"%")
		idx++
	}
	if c := r.URL.Query().Get("cursor"); c != "" {
		cur, e := decodeCursor(c)
		if e != nil {
			fail(w, 400, "invalid cursor")
			return
		}
		where += fmt.Sprintf(" AND (created_at,id) < ($%d,$%d::uuid)", idx, idx+1)
		args = append(args, cur.T, cur.ID)
	}
	q := fmt.Sprintf(`SELECT id::text,project_id::text,title,status,assigned_to,configuration,dependencies::text[],version,created_at,updated_at FROM tasks WHERE %s ORDER BY created_at DESC,id DESC LIMIT $2`, where)
	rows, err := s.DB.Query(r.Context(), q, args...)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	defer rows.Close()
	tasks := []domain.Task{}
	times := []time.Time{}
	for rows.Next() {
		var t domain.Task
		var cfg []byte
		var c, u time.Time
		if err := rows.Scan(&t.ID, &t.ProjectID, &t.Title, &t.Status, &t.AssignedTo, &cfg, &t.Dependencies, &t.Version, &c, &u); err != nil {
			fail(w, 500, err.Error())
			return
		}
		_ = json.Unmarshal(cfg, &t.Configuration)
		t.CreatedAt = c.UTC().Format(time.RFC3339Nano)
		t.UpdatedAt = u.UTC().Format(time.RFC3339Nano)
		tasks = append(tasks, t)
		times = append(times, c)
	}
	next := ""
	if len(tasks) > limit {
		tasks = tasks[:limit]
		times = times[:limit]
		last := tasks[len(tasks)-1]
		next = encodeCursor(times[len(times)-1], last.ID)
	}
	jsonOut(w, 200, map[string]any{"items": tasks, "nextCursor": next, "syncCursor": syncCursor})
}

func defaultConfig(c domain.Configuration) domain.Configuration {
	if c.Priority == "" {
		c.Priority = "medium"
	}
	if c.Tags == nil {
		c.Tags = []string{}
	}
	if c.CustomFields == nil {
		c.CustomFields = map[string]any{}
	}
	return c
}

func (s *Server) createTask(w http.ResponseWriter, r *http.Request) {
	pid := r.PathValue("projectId")
	var in struct {
		Title         string               `json:"title"`
		Status        string               `json:"status"`
		AssignedTo    []string             `json:"assignedTo"`
		Configuration domain.Configuration `json:"configuration"`
		Dependencies  []string             `json:"dependencies"`
	}
	if err := decode(r, &in); err != nil {
		fail(w, 400, err.Error())
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" {
		fail(w, 400, "title is required")
		return
	}
	if in.Status == "" {
		in.Status = "todo"
	}
	if err := domain.ValidateStatus(in.Status); err != nil {
		fail(w, 400, err.Error())
		return
	}
	in.Configuration = defaultConfig(in.Configuration)
	if err := domain.ValidatePriority(in.Configuration.Priority); err != nil {
		fail(w, 400, err.Error())
		return
	}
	if in.AssignedTo == nil {
		in.AssignedTo = []string{}
	}
	if in.Dependencies == nil {
		in.Dependencies = []string{}
	}
	tx, err := s.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	if err := validateDependencies(r.Context(), tx, pid, "", in.Dependencies); err != nil {
		fail(w, 400, err.Error())
		return
	}
	cfg, _ := json.Marshal(in.Configuration)
	t, _, err := scanTask(tx.QueryRow(r.Context(), `INSERT INTO tasks(project_id,title,status,assigned_to,configuration,dependencies) VALUES($1,$2,$3,$4,$5,$6::uuid[]) RETURNING id::text,project_id::text,title,status,assigned_to,configuration,dependencies::text[],version,created_at,updated_at`, pid, in.Title, in.Status, in.AssignedTo, cfg, in.Dependencies))
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	if in.Status == "done" {
		if err := dependenciesDone(r.Context(), tx, t.Dependencies); err != nil {
			fail(w, 409, err.Error())
			return
		}
	}
	if _, err := insertEvent(r.Context(), tx, pid, "task.created", "task", t.ID, t); err != nil {
		fail(w, 500, err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		fail(w, 500, err.Error())
		return
	}
	jsonOut(w, 201, t)
}

func (s *Server) updateTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("taskId")
	var in struct {
		Title         *string               `json:"title"`
		Status        *string               `json:"status"`
		AssignedTo    *[]string             `json:"assignedTo"`
		Configuration *domain.Configuration `json:"configuration"`
		Dependencies  *[]string             `json:"dependencies"`
		Version       int                   `json:"version"`
	}
	if err := decode(r, &in); err != nil {
		fail(w, 400, err.Error())
		return
	}
	if in.Version < 1 {
		fail(w, 400, "version is required for optimistic concurrency")
		return
	}
	tx, err := s.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	current, _, err := scanTask(tx.QueryRow(r.Context(), `SELECT id::text,project_id::text,title,status,assigned_to,configuration,dependencies::text[],version,created_at,updated_at FROM tasks WHERE id=$1 FOR UPDATE`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "task not found")
		return
	}
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	if current.Version != in.Version {
		jsonOut(w, 409, map[string]any{"error": "version conflict", "current": current})
		return
	}
	next := current
	if in.Title != nil {
		v := strings.TrimSpace(*in.Title)
		if v == "" {
			fail(w, 400, "title cannot be empty")
			return
		}
		next.Title = v
	}
	if in.Status != nil {
		if err := domain.ValidateTransition(current.Status, *in.Status); err != nil {
			fail(w, 409, err.Error())
			return
		}
		next.Status = *in.Status
	}
	if in.AssignedTo != nil {
		next.AssignedTo = *in.AssignedTo
	}
	if in.Configuration != nil {
		next.Configuration = defaultConfig(*in.Configuration)
		if err := domain.ValidatePriority(next.Configuration.Priority); err != nil {
			fail(w, 400, err.Error())
			return
		}
	}
	if in.Dependencies != nil {
		next.Dependencies = *in.Dependencies
		if err := validateDependencies(r.Context(), tx, current.ProjectID, id, next.Dependencies); err != nil {
			fail(w, 400, err.Error())
			return
		}
	}
	if next.Status == "done" {
		if err := dependenciesDone(r.Context(), tx, next.Dependencies); err != nil {
			fail(w, 409, err.Error())
			return
		}
	}
	if current.Status == "done" && next.Status != "done" {
		var completedDependents int
		if err := tx.QueryRow(r.Context(), `SELECT count(*) FROM tasks WHERE project_id=$1 AND $2::uuid = ANY(dependencies) AND status='done'`, current.ProjectID, id).Scan(&completedDependents); err != nil {
			fail(w, 500, err.Error())
			return
		}
		if completedDependents > 0 {
			fail(w, 409, "cannot reopen task while completed dependents rely on it")
			return
		}
	}
	cfg, _ := json.Marshal(next.Configuration)
	next, _, err = scanTask(tx.QueryRow(r.Context(), `UPDATE tasks SET title=$2,status=$3,assigned_to=$4,configuration=$5,dependencies=$6::uuid[],version=version+1,updated_at=now() WHERE id=$1 RETURNING id::text,project_id::text,title,status,assigned_to,configuration,dependencies::text[],version,created_at,updated_at`, id, next.Title, next.Status, next.AssignedTo, cfg, next.Dependencies))
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	if in.Dependencies != nil {
		var cycle bool
		err = tx.QueryRow(r.Context(), `WITH RECURSIVE walk(id) AS (SELECT unnest(dependencies) FROM tasks WHERE id=$1 UNION SELECT unnest(t.dependencies) FROM tasks t JOIN walk w ON t.id=w.id) SELECT EXISTS(SELECT 1 FROM walk WHERE id=$1)`, id).Scan(&cycle)
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		if cycle {
			fail(w, 409, "dependency cycle detected")
			return
		}
	}
	patch := map[string]any{"task": next, "previousVersion": current.Version}
	if _, err := insertEvent(r.Context(), tx, current.ProjectID, "task.updated", "task", id, patch); err != nil {
		fail(w, 500, err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		fail(w, 500, err.Error())
		return
	}
	jsonOut(w, 200, next)
}

func (s *Server) deleteTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("taskId")
	tx, err := s.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	var pid string
	err = tx.QueryRow(r.Context(), `SELECT project_id::text FROM tasks WHERE id=$1 FOR UPDATE`, id).Scan(&pid)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "task not found")
		return
	}
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	var refs int
	_ = tx.QueryRow(r.Context(), `SELECT count(*) FROM tasks WHERE project_id=$1 AND $2::uuid = ANY(dependencies)`, pid, id).Scan(&refs)
	if refs > 0 {
		fail(w, 409, "task is still referenced by another task dependency")
		return
	}
	if _, err := tx.Exec(r.Context(), `DELETE FROM tasks WHERE id=$1`, id); err != nil {
		fail(w, 500, err.Error())
		return
	}
	if _, err := insertEvent(r.Context(), tx, pid, "task.deleted", "task", id, map[string]string{"id": id}); err != nil {
		fail(w, 500, err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		fail(w, 500, err.Error())
		return
	}
	w.WriteHeader(204)
}

func validateDependencies(ctx context.Context, tx pgx.Tx, pid, taskID string, deps []string) error {
	if len(deps) == 0 {
		return nil
	}
	for _, d := range deps {
		if d == taskID && taskID != "" {
			return errors.New("task cannot depend on itself")
		}
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE project_id=$1 AND id = ANY($2::uuid[])`, pid, deps).Scan(&n); err != nil {
		return err
	}
	if n != len(deps) {
		return errors.New("all dependencies must exist in the same project")
	}
	return nil
}
func dependenciesDone(ctx context.Context, tx pgx.Tx, deps []string) error {
	if len(deps) == 0 {
		return nil
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE id=ANY($1::uuid[]) AND status <> 'done'`, deps).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return errors.New("all dependencies must be done before this task can be completed")
	}
	return nil
}

func (s *Server) listComments(w http.ResponseWriter, r *http.Request) {
	rows, err := s.DB.Query(r.Context(), `SELECT id::text,task_id::text,content,author,timestamp FROM comments WHERE task_id=$1 ORDER BY timestamp ASC`, r.PathValue("taskId"))
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []domain.Comment{}
	for rows.Next() {
		var c domain.Comment
		var t time.Time
		if err := rows.Scan(&c.ID, &c.TaskID, &c.Content, &c.Author, &t); err != nil {
			fail(w, 500, err.Error())
			return
		}
		c.Timestamp = t.UTC().Format(time.RFC3339Nano)
		out = append(out, c)
	}
	jsonOut(w, 200, out)
}
func (s *Server) createComment(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("taskId")
	var in struct {
		Content string `json:"content"`
		Author  string `json:"author"`
	}
	if err := decode(r, &in); err != nil {
		fail(w, 400, err.Error())
		return
	}
	in.Content = strings.TrimSpace(in.Content)
	in.Author = strings.TrimSpace(in.Author)
	if in.Content == "" || in.Author == "" {
		fail(w, 400, "content and author are required")
		return
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	var pid string
	if err := tx.QueryRow(r.Context(), `SELECT project_id::text FROM tasks WHERE id=$1`, id).Scan(&pid); errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "task not found")
		return
	} else if err != nil {
		fail(w, 500, err.Error())
		return
	}
	var c domain.Comment
	var ts time.Time
	if err := tx.QueryRow(r.Context(), `INSERT INTO comments(task_id,content,author) VALUES($1,$2,$3) RETURNING id::text,task_id::text,content,author,timestamp`, id, in.Content, in.Author).Scan(&c.ID, &c.TaskID, &c.Content, &c.Author, &ts); err != nil {
		fail(w, 500, err.Error())
		return
	}
	c.Timestamp = ts.UTC().Format(time.RFC3339Nano)
	if _, err := insertEvent(r.Context(), tx, pid, "comment.created", "comment", c.ID, c); err != nil {
		fail(w, 500, err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		fail(w, 500, err.Error())
		return
	}
	jsonOut(w, 201, c)
}

func insertEvent(ctx context.Context, tx pgx.Tx, pid, eventType, entityType, entityID string, payload any) (int64, error) {
	raw, _ := json.Marshal(payload)
	var id int64
	err := tx.QueryRow(ctx, `INSERT INTO event_log(project_id,event_type,entity_type,entity_id,payload) VALUES($1,$2,$3,$4,$5) RETURNING id`, pid, eventType, entityType, entityID, raw).Scan(&id)
	if err != nil {
		return 0, err
	}
	_, err = tx.Exec(ctx, `SELECT pg_notify('task_events',$1)`, strconv.FormatInt(id, 10))
	return id, err
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	pid := r.URL.Query().Get("projectId")
	if pid == "" {
		fail(w, 400, "projectId is required")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		fail(w, 500, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	last := eventCursor(r)

	// Subscribe before replay. Notifications are only wake-ups; canonical ordered events
	// are always read from event_log, so dropped in-memory notifications cannot create gaps.
	subID, ch := s.Broker.Subscribe()
	defer s.Broker.Unsubscribe(subID)
	catchUp := func() error {
		for {
			rows, err := s.DB.Query(r.Context(), `SELECT id,project_id::text,event_type,entity_type,entity_id::text,payload,created_at::text FROM event_log WHERE project_id=$1 AND id>$2 ORDER BY id ASC LIMIT 1000`, pid, last)
			if err != nil {
				return err
			}
			count := 0
			for rows.Next() {
				var e domain.Event
				if rows.Scan(&e.ID, &e.ProjectID, &e.EventType, &e.EntityType, &e.EntityID, &e.Payload, &e.CreatedAt) == nil {
					writeEvent(w, e)
					last = e.ID
					count++
				}
			}
			rows.Close()
			flusher.Flush()
			if count < 1000 {
				return nil
			}
		}
	}
	if err := catchUp(); err != nil {
		return
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case e, ok := <-ch:
			if !ok {
				return
			}
			if e.ProjectID == pid && e.ID > last {
				if err := catchUp(); err != nil {
					return
				}
			}
		case <-ticker.C:
			if err := catchUp(); err != nil {
				return
			}
			fmt.Fprint(w, ": heartbeat\n\n")
			flusher.Flush()
		}
	}
}

func writeEvent(w http.ResponseWriter, e domain.Event) {
	fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", e.ID, e.EventType, string(e.Payload))
}

func (s *Server) projectEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		fail(w, 500, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	last := eventCursor(r)
	subID, ch := s.Broker.Subscribe()
	defer s.Broker.Unsubscribe(subID)

	replay := func() error {
		for {
			rows, err := s.DB.Query(r.Context(), `SELECT id,project_id::text,event_type,entity_type,entity_id::text,payload,created_at::text FROM event_log WHERE entity_type='project' AND id>$1 ORDER BY id ASC LIMIT 1000`, last)
			if err != nil {
				return err
			}
			count := 0
			for rows.Next() {
				var e domain.Event
				if rows.Scan(&e.ID, &e.ProjectID, &e.EventType, &e.EntityType, &e.EntityID, &e.Payload, &e.CreatedAt) == nil {
					writeEvent(w, e)
					last = e.ID
					count++
				}
			}
			rows.Close()
			flusher.Flush()
			if count < 1000 {
				return nil
			}
		}
	}
	if err := replay(); err != nil {
		return
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case e, ok := <-ch:
			if !ok {
				return
			}
			if e.EntityType == "project" && e.ID > last {
				if err := replay(); err != nil {
					return
				}
			}
		case <-ticker.C:
			if err := replay(); err != nil {
				return
			}
			fmt.Fprint(w, ": heartbeat\n\n")
			flusher.Flush()
		}
	}
}

func eventCursor(r *http.Request) int64 {
	v := r.Header.Get("Last-Event-ID")
	if v == "" {
		v = r.URL.Query().Get("lastEventId")
	}
	if v == "" {
		v = r.URL.Query().Get("after")
	}
	n, _ := strconv.ParseInt(v, 10, 64)
	return n
}

type eventEnvelope struct {
	ID         int64           `json:"id"`
	ProjectID  string          `json:"projectId"`
	EventType  string          `json:"eventType"`
	EntityType string          `json:"entityType"`
	EntityID   string          `json:"entityId"`
	Payload    json.RawMessage `json:"payload"`
	CreatedAt  string          `json:"createdAt"`
}

func (s *Server) eventDeltas(w http.ResponseWriter, r *http.Request) {
	after := eventCursor(r)
	limit := 250
	if q := r.URL.Query().Get("limit"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}
	pid := strings.TrimSpace(r.URL.Query().Get("projectId"))
	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	var rows pgx.Rows
	var err error
	if scope == "projects" {
		rows, err = s.DB.Query(r.Context(), `SELECT id,project_id::text,event_type,entity_type,entity_id::text,payload,created_at::text FROM event_log WHERE entity_type='project' AND id>$1 ORDER BY id ASC LIMIT $2`, after, limit)
	} else if pid != "" {
		rows, err = s.DB.Query(r.Context(), `SELECT id,project_id::text,event_type,entity_type,entity_id::text,payload,created_at::text FROM event_log WHERE project_id=$1 AND id>$2 ORDER BY id ASC LIMIT $3`, pid, after, limit)
	} else {
		fail(w, 400, "projectId or scope=projects is required")
		return
	}
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	defer rows.Close()
	items := []eventEnvelope{}
	next := after
	for rows.Next() {
		var e eventEnvelope
		if err := rows.Scan(&e.ID, &e.ProjectID, &e.EventType, &e.EntityType, &e.EntityID, &e.Payload, &e.CreatedAt); err != nil {
			fail(w, 500, err.Error())
			return
		}
		items = append(items, e)
		next = e.ID
	}
	jsonOut(w, 200, map[string]any{"items": items, "nextCursor": next})
}

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 8<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("request body must contain exactly one JSON value")
		}
		return err
	}
	return nil
}
func jsonOut(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, msg string) {
	jsonOut(w, status, map[string]string{"error": msg})
}
