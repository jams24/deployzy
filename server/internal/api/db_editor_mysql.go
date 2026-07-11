package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/serverme/serverme/server/internal/db"
)

// mysqlDSNForService builds a go-sql-driver DSN for a MySQL service.
// Uses PublicHost/PublicPort when set (containerised services with mapped ports).
func mysqlDSNForService(svc *db.Service) string {
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
	if svc.PublicHost != nil && *svc.PublicHost != "" {
		host = *svc.PublicHost
	}
	if svc.PublicPort != nil && *svc.PublicPort > 0 {
		port = *svc.PublicPort
	}
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?timeout=30s&readTimeout=30s&writeTimeout=30s&parseTime=true",
		dbUser, dbPass, host, port, dbName)
}

// openMySQLConn opens a dedicated *sql.Conn and configures ANSI_QUOTES so that
// the same double-quoted identifier syntax used by the Postgres editor works here.
func openMySQLConn(ctx context.Context, dsn string) (*sql.Conn, *sql.DB, error) {
	mdb, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, nil, err
	}
	mdb.SetMaxOpenConns(1)
	mdb.SetConnMaxLifetime(60 * time.Second)
	conn, err := mdb.Conn(ctx)
	if err != nil {
		mdb.Close()
		return nil, nil, err
	}
	// ANSI_QUOTES lets "identifier" work the same way as in Postgres.
	conn.ExecContext(ctx, "SET SESSION sql_mode = CONCAT(@@sql_mode, ',ANSI_QUOTES')")
	return conn, mdb, nil
}

// runMySQLQueryAndWrite executes an arbitrary SQL statement and writes a queryResponse.
// SELECT/SHOW/EXPLAIN/DESCRIBE/WITH → returns rows; everything else → returns rows_affected.
func runMySQLQueryAndWrite(w http.ResponseWriter, r *http.Request, dsn string) {
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

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	conn, mdb, err := openMySQLConn(ctx, dsn)
	if err != nil {
		writeError(w, http.StatusBadGateway, "connect failed: "+err.Error())
		return
	}
	defer mdb.Close()
	defer conn.Close()
	conn.ExecContext(ctx, "SET SESSION max_execution_time = 10000") // 10 s

	start := time.Now()
	resp := queryResponse{Columns: []string{}, Rows: [][]interface{}{}, Types: []string{}}

	upper := strings.TrimSpace(strings.ToUpper(req.SQL))
	isSelect := strings.HasPrefix(upper, "SELECT") ||
		strings.HasPrefix(upper, "SHOW") ||
		strings.HasPrefix(upper, "EXPLAIN") ||
		strings.HasPrefix(upper, "DESCRIBE") ||
		strings.HasPrefix(upper, "WITH")

	if isSelect {
		rows, err := conn.QueryContext(ctx, req.SQL)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		defer rows.Close()

		colTypes, _ := rows.ColumnTypes()
		for _, ct := range colTypes {
			resp.Columns = append(resp.Columns, ct.Name())
			resp.Types = append(resp.Types, mysqlTypeName(ct.DatabaseTypeName()))
		}

		count := 0
		for rows.Next() {
			if count >= maxRows {
				resp.Truncated = true
				break
			}
			vals := make([]interface{}, len(colTypes))
			ptrs := make([]interface{}, len(colTypes))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				continue
			}
			for i, v := range vals {
				vals[i] = normalizeForJSON(v)
			}
			resp.Rows = append(resp.Rows, vals)
			count++
		}
		if err := rows.Err(); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	} else {
		result, err := conn.ExecContext(ctx, req.SQL)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		n, _ := result.RowsAffected()
		resp.RowsAffected = n
	}

	resp.DurationMs = time.Since(start).Milliseconds()
	if resp.Truncated {
		resp.Notice = fmt.Sprintf("result truncated to first %d rows", maxRows)
	}
	writeJSON(w, http.StatusOK, resp)
}

// mysqlTypeName maps MySQL column type names to the simplified set used by the editor UI.
func mysqlTypeName(dbType string) string {
	switch strings.ToUpper(dbType) {
	case "TINYINT", "SMALLINT", "MEDIUMINT", "INT", "INTEGER", "BIGINT", "YEAR":
		return "int"
	case "DECIMAL", "NUMERIC", "FLOAT", "DOUBLE", "REAL":
		return "numeric"
	case "DATETIME", "TIMESTAMP":
		return "timestamp"
	case "DATE":
		return "date"
	case "JSON":
		return "json"
	case "TINYBLOB", "BLOB", "MEDIUMBLOB", "LONGBLOB", "BINARY", "VARBINARY":
		return "bytea"
	default:
		return "text"
	}
}

// listMySQLTables returns all base tables in the current database.
func listMySQLTables(w http.ResponseWriter, r *http.Request, dsn string) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	conn, mdb, err := openMySQLConn(ctx, dsn)
	if err != nil {
		writeError(w, http.StatusBadGateway, "connect failed")
		return
	}
	defer mdb.Close()
	defer conn.Close()

	rows, err := conn.QueryContext(ctx, `
		SELECT TABLE_NAME,
		       COALESCE(TABLE_ROWS, 0),
		       COALESCE(DATA_LENGTH + INDEX_LENGTH, 0),
		       CASE WHEN COALESCE(DATA_LENGTH + INDEX_LENGTH, 0) >= 1073741824
		            THEN CONCAT(ROUND((DATA_LENGTH + INDEX_LENGTH) / 1073741824.0, 1), ' GB')
		            WHEN COALESCE(DATA_LENGTH + INDEX_LENGTH, 0) >= 1048576
		            THEN CONCAT(ROUND((DATA_LENGTH + INDEX_LENGTH) / 1048576.0, 1), ' MB')
		            WHEN COALESCE(DATA_LENGTH + INDEX_LENGTH, 0) >= 1024
		            THEN CONCAT(ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024.0, 1), ' KB')
		            ELSE CONCAT(COALESCE(DATA_LENGTH + INDEX_LENGTH, 0), ' B')
		       END
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
		ORDER BY TABLE_NAME`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed: "+err.Error())
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

// listMySQLColumns returns column metadata for a MySQL table.
func listMySQLColumns(w http.ResponseWriter, r *http.Request, dsn, table string) {
	if !isValidIdentifier(table) {
		writeError(w, http.StatusBadRequest, "invalid table name")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	conn, mdb, err := openMySQLConn(ctx, dsn)
	if err != nil {
		writeError(w, http.StatusBadGateway, "connect failed")
		return
	}
	defer mdb.Close()
	defer conn.Close()

	rows, err := conn.QueryContext(ctx, `
		SELECT COLUMN_NAME,
		       DATA_TYPE,
		       IS_NULLABLE,
		       COALESCE(COLUMN_DEFAULT, ''),
		       COLUMN_KEY
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
		ORDER BY ORDINAL_POSITION`, table)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	var cols []columnInfo
	for rows.Next() {
		var c columnInfo
		var colKey string
		if err := rows.Scan(&c.Name, &c.DataType, &c.IsNullable, &c.Default, &colKey); err != nil {
			continue
		}
		c.IsPrimaryKey = colKey == "PRI"
		cols = append(cols, c)
	}
	if cols == nil {
		cols = []columnInfo{}
	}
	writeJSON(w, http.StatusOK, cols)
}

// browseMySQLRows returns paginated rows from a MySQL table.
func browseMySQLRows(w http.ResponseWriter, r *http.Request, dsn, table string) {
	if !isValidIdentifier(table) {
		writeError(w, http.StatusBadRequest, "invalid table name")
		return
	}
	limit, offset := 50, 0
	orderBy, orderDir := "", "ASC"
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
	conn, mdb, err := openMySQLConn(ctx, dsn)
	if err != nil {
		writeError(w, http.StatusBadGateway, "connect failed")
		return
	}
	defer mdb.Close()
	defer conn.Close()
	conn.ExecContext(ctx, "SET SESSION max_execution_time = 10000")

	// Row count: use information_schema estimate, exact COUNT for small tables.
	var totalRows int64
	conn.QueryRowContext(ctx,
		"SELECT COALESCE(TABLE_ROWS, 0) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
		table).Scan(&totalRows)
	if totalRows < 10000 {
		conn.QueryRowContext(ctx, fmt.Sprintf("SELECT COUNT(*) FROM %s", quoteIdentMySQL(table))).Scan(&totalRows)
	}

	q := fmt.Sprintf("SELECT * FROM %s", quoteIdentMySQL(table))
	if orderBy != "" {
		q += fmt.Sprintf(" ORDER BY %s %s", quoteIdentMySQL(orderBy), orderDir)
	}
	q += fmt.Sprintf(" LIMIT %d OFFSET %d", limit, offset)

	rows, err := conn.QueryContext(ctx, q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	colTypes, _ := rows.ColumnTypes()
	var columns, types []string
	for _, ct := range colTypes {
		columns = append(columns, ct.Name())
		types = append(types, mysqlTypeName(ct.DatabaseTypeName()))
	}

	var data [][]interface{}
	for rows.Next() {
		vals := make([]interface{}, len(colTypes))
		ptrs := make([]interface{}, len(colTypes))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			continue
		}
		for i, v := range vals {
			vals[i] = normalizeForJSON(v)
		}
		data = append(data, vals)
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

// quoteIdentMySQL wraps an identifier in MySQL backticks.
func quoteIdentMySQL(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "``") + "`"
}
