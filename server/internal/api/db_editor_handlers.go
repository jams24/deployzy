package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/db"
)

// ── SQL runner endpoints ─────────────────────────────────────────────────
//
// Two surfaces, one shared implementation:
//   POST /api/v1/projects/{projectId}/database/query   → project-attached DB
//   POST /api/v1/services/{serviceId}/query            → standalone service
//
// Security model relies on Postgres's own isolation, not app logic:
//   • `pg_hba sameuser` means the role can ONLY connect to its own DB, even
//     if the user crafts a cross-DB `\c` — Postgres refuses.
//   • Each query runs in its own short-lived pgx.Conn; closed after response.
//   • statement_timeout = 10s kills runaway queries.
//   • Results capped at maxRows so a big SELECT can't OOM the caller.

const (
	queryStatementTimeout = "10s"
	maxRows               = 1000
	maxQueryLength        = 100_000 // 100 KB — plenty for real queries, guards memory
)

type queryRequest struct {
	SQL string `json:"sql"`
}

type queryResponse struct {
	Columns      []string          `json:"columns"`
	Rows         [][]interface{}   `json:"rows"`
	RowsAffected int64             `json:"rows_affected"`
	DurationMs   int64             `json:"duration_ms"`
	Truncated    bool              `json:"truncated"` // true if hit maxRows limit
	Notice       string            `json:"notice,omitempty"`
	Types        []string          `json:"types"`     // column type OIDs as strings
}

// handleProjectDatabaseQuery runs SQL against the project-attached Postgres DB.
func (s *Server) handleProjectDatabaseQuery(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	pdb, _ := s.db.GetProjectDatabase(r.Context(), projectID)
	if pdb == nil {
		writeError(w, http.StatusNotFound, "no database attached to this project")
		return
	}

	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		pdb.DBUser, pdb.DBPassword, pdb.Host, pdb.Port, pdb.DBName)

	runQueryAndWrite(w, r, dsn)
}

// handleServiceQuery runs SQL against a standalone service (platform or BYOC).
func (s *Server) handleServiceQuery(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	serviceID := chi.URLParam(r, "serviceId")

	svc, _ := s.db.GetService(r.Context(), serviceID)
	if svc == nil || svc.UserID != u.ID {
		writeError(w, http.StatusNotFound, "service not found")
		return
	}
	if svc.Type != "postgres" {
		writeError(w, http.StatusBadRequest, "query runner only supports postgres services")
		return
	}

	dsn := dsnForService(svc)
	if dsn == "" {
		writeError(w, http.StatusInternalServerError, "could not resolve service connection")
		return
	}

	runQueryAndWrite(w, r, dsn)
}

// dsnForService builds a connection string. For platform-hosted services the
// host is "localhost" + platform Postgres; for BYOC services it's the user's
// public VPS host + the container's published port.
func dsnForService(svc *db.Service) string {
	dbName, dbUser, dbPass := "", "", ""
	if svc.DBName != nil {
		dbName = *svc.DBName
	}
	if svc.DBUser != nil {
		dbUser = *svc.DBUser
	}
	if svc.DBPassword != nil {
		dbPass = *svc.DBPassword
	}
	host := svc.Host
	port := svc.Port
	// BYOC override — public_host/public_port always beat the legacy Host/Port
	// when set, since those point at the user's VPS rather than platform PG.
	if svc.PublicHost != nil && *svc.PublicHost != "" {
		host = *svc.PublicHost
	}
	if svc.PublicPort != nil && *svc.PublicPort > 0 {
		port = *svc.PublicPort
	}
	if dbName == "" || dbUser == "" {
		return ""
	}
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		dbUser, dbPass, host, port, dbName)
}

func runQueryAndWrite(w http.ResponseWriter, r *http.Request, dsn string) {
	var req queryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	req.SQL = strings.TrimSpace(req.SQL)
	if req.SQL == "" {
		writeError(w, http.StatusBadRequest, "sql is required")
		return
	}
	if len(req.SQL) > maxQueryLength {
		writeError(w, http.StatusBadRequest, "sql too large")
		return
	}

	// Short-lived connection — open, run, close. Avoids contention with the
	// platform's main pool and means a timeout kills only this conn.
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		writeError(w, http.StatusBadGateway, "connect failed: "+sanitizePGError(err.Error()))
		return
	}
	defer conn.Close(ctx)

	// Per-session statement timeout — safety against infinite queries.
	if _, err := conn.Exec(ctx, "SET statement_timeout = "+quoteLiteral(queryStatementTimeout)); err != nil {
		writeError(w, http.StatusInternalServerError, "session setup failed: "+sanitizePGError(err.Error()))
		return
	}

	start := time.Now()
	resp := queryResponse{Columns: []string{}, Rows: [][]interface{}{}, Types: []string{}}

	// Detect if it's a SELECT (returns rows) or DML (returns count). We run
	// everything via Query() — pgx is happy with DML through Query and surfaces
	// rows_affected from the command tag.
	rows, err := conn.Query(ctx, req.SQL)
	if err != nil {
		writeError(w, http.StatusBadRequest, sanitizePGError(err.Error()))
		return
	}
	defer rows.Close()

	// Capture column metadata.
	for _, fd := range rows.FieldDescriptions() {
		resp.Columns = append(resp.Columns, string(fd.Name))
		resp.Types = append(resp.Types, pgTypeName(fd.DataTypeOID))
	}

	count := 0
	for rows.Next() {
		if count >= maxRows {
			resp.Truncated = true
			break
		}
		values, err := rows.Values()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "scan error: "+err.Error())
			return
		}
		// Normalise values that JSON can't serialize natively (bytea, time
		// types, etc). pgx returns `[]byte`, `time.Time`, `pgtype.*` — convert
		// to string for the UI table view.
		for i, v := range values {
			values[i] = normalizeForJSON(v)
		}
		resp.Rows = append(resp.Rows, values)
		count++
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusBadRequest, sanitizePGError(err.Error()))
		return
	}

	tag := rows.CommandTag()
	resp.RowsAffected = tag.RowsAffected()
	resp.DurationMs = time.Since(start).Milliseconds()

	if resp.Truncated {
		resp.Notice = fmt.Sprintf("result truncated to first %d rows", maxRows)
	}

	writeJSON(w, http.StatusOK, resp)
}

// normalizeForJSON turns pgx-native values into JSON-friendly ones. Unknown
// types fall through as-is (json.Marshal handles built-in kinds).
func normalizeForJSON(v interface{}) interface{} {
	switch x := v.(type) {
	case nil:
		return nil
	case []byte:
		return string(x)
	case time.Time:
		return x.UTC().Format(time.RFC3339Nano)
	}
	return v
}

// quoteLiteral safely wraps a string as a Postgres SQL literal.
// Only used with constant, whitelisted values (statement_timeout).
func quoteLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// sanitizePGError strips credentials/hosts that pgx sometimes echoes into
// error strings (e.g. "failed to connect to `host=1.2.3.4 user=foo`").
func sanitizePGError(s string) string {
	// Drop anything after "failed to connect to `...`"
	if i := strings.Index(s, "failed to connect to `"); i >= 0 {
		if j := strings.Index(s[i:], "`"); j >= 0 {
			if k := strings.Index(s[i+j+1:], "`"); k >= 0 {
				s = s[:i+j+1] + "<redacted>" + s[i+j+1+k:]
			}
		}
	}
	return s
}

// pgTypeName gives humans a hint about column types without importing the
// full pgtype OID table. Covers the common ones; others become "oid=N".
func pgTypeName(oid uint32) string {
	switch oid {
	case 16:
		return "bool"
	case 20, 21, 23:
		return "int"
	case 25, 1043, 1042:
		return "text"
	case 700, 701, 1700:
		return "numeric"
	case 1082:
		return "date"
	case 1114, 1184:
		return "timestamp"
	case 2950:
		return "uuid"
	case 114, 3802:
		return "json"
	case 17:
		return "bytea"
	}
	return fmt.Sprintf("oid=%d", oid)
}

// ── Browse endpoints ─────────────────────────────────────────────────────
//
// These power the table-browser UI: sidebar listing tables, clicking a table
// shows its columns + rows with pagination. All read-only, all use the same
// resolveServiceDSN / resolveProjectDSN pattern so BYOC works seamlessly.

// handleServiceTables lists all user-created tables in a standalone service's DB.
func (s *Server) handleServiceTables(w http.ResponseWriter, r *http.Request) {
	dsn, err := s.resolveServiceDSN(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	listTables(w, r, dsn)
}

// handleServiceTableColumns returns column metadata for a table.
func (s *Server) handleServiceTableColumns(w http.ResponseWriter, r *http.Request) {
	dsn, err := s.resolveServiceDSN(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	table := chi.URLParam(r, "table")
	listColumns(w, r, dsn, table)
}

// handleServiceTableRows returns paginated rows for a table.
func (s *Server) handleServiceTableRows(w http.ResponseWriter, r *http.Request) {
	dsn, err := s.resolveServiceDSN(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	table := chi.URLParam(r, "table")
	browseRows(w, r, dsn, table)
}

// handleProjectDatabaseTables lists tables in a project-attached DB.
func (s *Server) handleProjectDatabaseTables(w http.ResponseWriter, r *http.Request) {
	dsn, err := s.resolveProjectDSN(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	listTables(w, r, dsn)
}

// handleProjectDatabaseTableColumns returns column metadata for a project DB table.
func (s *Server) handleProjectDatabaseTableColumns(w http.ResponseWriter, r *http.Request) {
	dsn, err := s.resolveProjectDSN(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	table := chi.URLParam(r, "table")
	listColumns(w, r, dsn, table)
}

// handleProjectDatabaseTableRows returns paginated rows for a project DB table.
func (s *Server) handleProjectDatabaseTableRows(w http.ResponseWriter, r *http.Request) {
	dsn, err := s.resolveProjectDSN(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	table := chi.URLParam(r, "table")
	browseRows(w, r, dsn, table)
}

// ── DSN resolvers (reusable across query + browse endpoints) ─────────────

func (s *Server) resolveServiceDSN(r *http.Request) (string, error) {
	u := auth.GetUser(r)
	serviceID := chi.URLParam(r, "serviceId")
	svc, _ := s.db.GetService(r.Context(), serviceID)
	if svc == nil || svc.UserID != u.ID {
		return "", fmt.Errorf("service not found")
	}
	if svc.Type != "postgres" {
		return "", fmt.Errorf("only postgres services are browsable")
	}
	dsn := dsnForService(svc)
	if dsn == "" {
		return "", fmt.Errorf("could not resolve connection")
	}
	return dsn, nil
}

func (s *Server) resolveProjectDSN(r *http.Request) (string, error) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")
	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		return "", fmt.Errorf("project not found")
	}
	pdb, _ := s.db.GetProjectDatabase(r.Context(), projectID)
	if pdb == nil {
		return "", fmt.Errorf("no database attached")
	}
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		pdb.DBUser, pdb.DBPassword, pdb.Host, pdb.Port, pdb.DBName), nil
}

// ── Shared browse implementations ────────────────────────────────────────

type tableInfo struct {
	Name        string `json:"name"`
	RowEstimate int64  `json:"row_estimate"`
	SizeBytes   int64  `json:"size_bytes"`
	SizePretty  string `json:"size_pretty"`
}

func listTables(w http.ResponseWriter, r *http.Request, dsn string) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		writeError(w, http.StatusBadGateway, "connect failed")
		return
	}
	defer conn.Close(ctx)

	rows, err := conn.Query(ctx, `
		SELECT c.relname,
		       c.reltuples::bigint AS row_estimate,
		       pg_total_relation_size(c.oid) AS size_bytes,
		       pg_size_pretty(pg_total_relation_size(c.oid)) AS size_pretty
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
		ORDER BY c.relname`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed: "+sanitizePGError(err.Error()))
		return
	}
	defer rows.Close()

	var tables []tableInfo
	for rows.Next() {
		var t tableInfo
		if err := rows.Scan(&t.Name, &t.RowEstimate, &t.SizeBytes, &t.SizePretty); err != nil {
			continue
		}
		tables = append(tables, t)
	}
	if tables == nil {
		tables = []tableInfo{}
	}
	writeJSON(w, http.StatusOK, tables)
}

type columnInfo struct {
	Name         string `json:"name"`
	DataType     string `json:"data_type"`
	IsNullable   string `json:"is_nullable"`
	Default      string `json:"column_default"`
	IsPrimaryKey bool   `json:"is_primary_key"`
}

func listColumns(w http.ResponseWriter, r *http.Request, dsn, table string) {
	if !isValidIdentifier(table) {
		writeError(w, http.StatusBadRequest, "invalid table name")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		writeError(w, http.StatusBadGateway, "connect failed")
		return
	}
	defer conn.Close(ctx)

	rows, err := conn.Query(ctx, `
		SELECT c.column_name,
		       c.data_type,
		       c.is_nullable,
		       COALESCE(c.column_default, ''),
		       EXISTS (
		         SELECT 1 FROM information_schema.table_constraints tc
		         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
		         WHERE tc.table_name = c.table_name
		           AND tc.constraint_type = 'PRIMARY KEY'
		           AND kcu.column_name = c.column_name
		       ) AS is_pk
		FROM information_schema.columns c
		WHERE c.table_schema = 'public' AND c.table_name = $1
		ORDER BY c.ordinal_position`, table)
	if err != nil {
		writeError(w, http.StatusInternalServerError, sanitizePGError(err.Error()))
		return
	}
	defer rows.Close()

	var cols []columnInfo
	for rows.Next() {
		var c columnInfo
		rows.Scan(&c.Name, &c.DataType, &c.IsNullable, &c.Default, &c.IsPrimaryKey)
		cols = append(cols, c)
	}
	if cols == nil {
		cols = []columnInfo{}
	}
	writeJSON(w, http.StatusOK, cols)
}

func browseRows(w http.ResponseWriter, r *http.Request, dsn, table string) {
	if !isValidIdentifier(table) {
		writeError(w, http.StatusBadRequest, "invalid table name")
		return
	}
	limit := 50
	offset := 0
	orderBy := ""
	orderDir := "ASC"
	if v := r.URL.Query().Get("limit"); v != "" {
		fmt.Sscanf(v, "%d", &limit)
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		fmt.Sscanf(v, "%d", &offset)
	}
	if v := r.URL.Query().Get("orderBy"); v != "" && isValidIdentifier(v) {
		orderBy = v
	}
	if r.URL.Query().Get("desc") == "true" {
		orderDir = "DESC"
	}
	if limit > 500 {
		limit = 500
	}
	if limit < 1 {
		limit = 50
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		writeError(w, http.StatusBadGateway, "connect failed")
		return
	}
	defer conn.Close(ctx)
	conn.Exec(ctx, "SET statement_timeout = '10s'")

	// Count total rows (approximate for big tables, exact for small)
	var totalRows int64
	conn.QueryRow(ctx, fmt.Sprintf(
		`SELECT CASE WHEN reltuples > 10000 THEN reltuples::bigint
		             ELSE (SELECT count(*) FROM %s)
		        END
		 FROM pg_class WHERE relname = $1`, quoteIdent(table)), table).Scan(&totalRows)

	// Build query
	q := fmt.Sprintf("SELECT * FROM %s", quoteIdent(table))
	if orderBy != "" {
		q += fmt.Sprintf(" ORDER BY %s %s", quoteIdent(orderBy), orderDir)
	}
	q += fmt.Sprintf(" LIMIT %d OFFSET %d", limit, offset)

	rows, err := conn.Query(ctx, q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, sanitizePGError(err.Error()))
		return
	}
	defer rows.Close()

	var columns []string
	var types []string
	for _, fd := range rows.FieldDescriptions() {
		columns = append(columns, string(fd.Name))
		types = append(types, pgTypeName(fd.DataTypeOID))
	}

	var data [][]interface{}
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			continue
		}
		for i, v := range values {
			values[i] = normalizeForJSON(v)
		}
		data = append(data, values)
	}
	if data == nil {
		data = [][]interface{}{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"columns":    columns,
		"types":      types,
		"rows":       data,
		"total_rows": totalRows,
		"limit":      limit,
		"offset":     offset,
	})
}

// isValidIdentifier prevents SQL injection in table/column names. Only allows
// alphanumeric + underscore — sufficient for pg names without quoting.
func isValidIdentifier(s string) bool {
	if s == "" || len(s) > 128 {
		return false
	}
	for _, c := range s {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
			return false
		}
	}
	return true
}

func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}
