package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/db"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func mongoClientForService(svc *db.Service) (*mongo.Client, *mongo.Database, error) {
	host := svc.Host
	port := svc.Port
	if svc.PublicHost != nil && *svc.PublicHost != "" {
		host = *svc.PublicHost
	}
	if svc.PublicPort != nil && *svc.PublicPort > 0 {
		port = *svc.PublicPort
	}

	dbName := ""
	if svc.DBName != nil {
		dbName = *svc.DBName
	}
	dbUser := ""
	if svc.DBUser != nil {
		dbUser = *svc.DBUser
	}
	dbPass := ""
	if svc.DBPassword != nil {
		dbPass = *svc.DBPassword
	}

	var uri string
	if dbUser != "" && dbPass != "" {
		uri = fmt.Sprintf("mongodb://%s:%s@%s:%d/%s?authSource=admin&connectTimeoutMS=5000&serverSelectionTimeoutMS=5000",
			dbUser, dbPass, host, port, dbName)
	} else {
		uri = fmt.Sprintf("mongodb://%s:%d/%s?connectTimeoutMS=5000&serverSelectionTimeoutMS=5000",
			host, port, dbName)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		return nil, nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		client.Disconnect(context.Background()) //nolint:errcheck
		return nil, nil, err
	}
	return client, client.Database(dbName), nil
}

func (s *Server) resolveMongoService(r *http.Request) (*db.Service, error) {
	u := auth.GetUser(r)
	serviceID := chi.URLParam(r, "serviceId")
	svc, _ := s.db.GetService(r.Context(), serviceID)
	if svc == nil || svc.UserID != u.ID {
		return nil, fmt.Errorf("service not found")
	}
	if svc.Type != "mongodb" {
		return nil, fmt.Errorf("not a mongodb service")
	}
	return svc, nil
}

// handleMongoCollections lists all collections with estimated document counts.
// GET /services/{serviceId}/mongo/collections
func (s *Server) handleMongoCollections(w http.ResponseWriter, r *http.Request) {
	svc, err := s.resolveMongoService(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()

	client, mdb, err := mongoClientForService(svc)
	if err != nil {
		writeError(w, http.StatusBadGateway, "connect: "+err.Error())
		return
	}
	defer client.Disconnect(context.Background()) //nolint:errcheck

	names, err := mdb.ListCollectionNames(ctx, bson.D{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	type colInfo struct {
		Name  string `json:"name"`
		Count int64  `json:"count"`
	}
	result := make([]colInfo, 0, len(names))
	for _, name := range names {
		count, _ := mdb.Collection(name).EstimatedDocumentCount(ctx)
		result = append(result, colInfo{Name: name, Count: count})
	}
	writeJSON(w, http.StatusOK, result)
}

// handleMongoDocs returns paginated documents from a collection.
// GET /services/{serviceId}/mongo/documents?collection=name&filter={}&skip=0&limit=50
func (s *Server) handleMongoDocs(w http.ResponseWriter, r *http.Request) {
	svc, err := s.resolveMongoService(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	colName := r.URL.Query().Get("collection")
	if colName == "" {
		writeError(w, http.StatusBadRequest, "collection required")
		return
	}

	var skip, limit int64 = 0, 50
	fmt.Sscanf(r.URL.Query().Get("skip"), "%d", &skip)
	fmt.Sscanf(r.URL.Query().Get("limit"), "%d", &limit)
	if limit < 1 || limit > 200 {
		limit = 50
	}

	filterStr := r.URL.Query().Get("filter")
	if filterStr == "" {
		filterStr = "{}"
	}

	var filterDoc bson.D
	if err := bson.UnmarshalExtJSON([]byte(filterStr), true, &filterDoc); err != nil {
		writeError(w, http.StatusBadRequest, "invalid filter: "+err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	client, mdb, err := mongoClientForService(svc)
	if err != nil {
		writeError(w, http.StatusBadGateway, "connect: "+err.Error())
		return
	}
	defer client.Disconnect(context.Background()) //nolint:errcheck

	col := mdb.Collection(colName)
	total, _ := col.CountDocuments(ctx, filterDoc)

	opts := options.Find().SetSkip(skip).SetLimit(limit)
	cursor, err := col.Find(ctx, filterDoc, opts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer cursor.Close(ctx)

	var rawDocs []bson.M
	if err := cursor.All(ctx, &rawDocs); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Serialize each doc as relaxed Extended JSON so ObjectIDs, dates, etc.
	// round-trip cleanly back to the driver on update/delete.
	jsonDocs := make([]json.RawMessage, 0, len(rawDocs))
	for _, doc := range rawDocs {
		b, merr := bson.MarshalExtJSON(doc, false, true)
		if merr != nil {
			continue
		}
		jsonDocs = append(jsonDocs, json.RawMessage(b))
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"documents": jsonDocs,
		"total":     total,
		"skip":      skip,
		"limit":     limit,
	})
}

// handleMongoInsertDoc inserts a new document.
// POST /services/{serviceId}/mongo/documents?collection=name
// Body: {"document": {...}}
func (s *Server) handleMongoInsertDoc(w http.ResponseWriter, r *http.Request) {
	svc, err := s.resolveMongoService(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	colName := r.URL.Query().Get("collection")
	if colName == "" {
		writeError(w, http.StatusBadRequest, "collection required")
		return
	}

	var body struct {
		Document json.RawMessage `json:"document"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Document == nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	var doc bson.D
	if err := bson.UnmarshalExtJSON(body.Document, false, &doc); err != nil {
		writeError(w, http.StatusBadRequest, "invalid document: "+err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	client, mdb, err := mongoClientForService(svc)
	if err != nil {
		writeError(w, http.StatusBadGateway, "connect: "+err.Error())
		return
	}
	defer client.Disconnect(context.Background()) //nolint:errcheck

	res, err := mdb.Collection(colName).InsertOne(ctx, doc)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"inserted_id": fmt.Sprintf("%v", res.InsertedID),
	})
}

// handleMongoUpdateDoc replaces a document. Server extracts _id from the doc to build the filter.
// PUT /services/{serviceId}/mongo/documents?collection=name
// Body: {"document": {...extended JSON with _id...}}
func (s *Server) handleMongoUpdateDoc(w http.ResponseWriter, r *http.Request) {
	svc, err := s.resolveMongoService(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	colName := r.URL.Query().Get("collection")
	if colName == "" {
		writeError(w, http.StatusBadRequest, "collection required")
		return
	}

	var body struct {
		Document json.RawMessage `json:"document"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Document == nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	var newDoc bson.D
	if err := bson.UnmarshalExtJSON(body.Document, false, &newDoc); err != nil {
		writeError(w, http.StatusBadRequest, "invalid document: "+err.Error())
		return
	}

	// Extract _id from the document to build the filter.
	var idVal interface{}
	for _, elem := range newDoc {
		if elem.Key == "_id" {
			idVal = elem.Value
			break
		}
	}
	if idVal == nil {
		writeError(w, http.StatusBadRequest, "document must include _id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	client, mdb, err := mongoClientForService(svc)
	if err != nil {
		writeError(w, http.StatusBadGateway, "connect: "+err.Error())
		return
	}
	defer client.Disconnect(context.Background()) //nolint:errcheck

	res, err := mdb.Collection(colName).ReplaceOne(ctx, bson.D{{Key: "_id", Value: idVal}}, newDoc)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"matched_count":  res.MatchedCount,
		"modified_count": res.ModifiedCount,
	})
}

// handleMongoDeleteDoc deletes a document by its _id (passed as extended JSON filter).
// DELETE /services/{serviceId}/mongo/documents?collection=name
// Body: {"filter": {"_id": {"$oid": "..."}}}
func (s *Server) handleMongoDeleteDoc(w http.ResponseWriter, r *http.Request) {
	svc, err := s.resolveMongoService(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	colName := r.URL.Query().Get("collection")
	if colName == "" {
		writeError(w, http.StatusBadRequest, "collection required")
		return
	}

	var body struct {
		Filter json.RawMessage `json:"filter"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Filter == nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	var filterDoc bson.D
	if err := bson.UnmarshalExtJSON(body.Filter, false, &filterDoc); err != nil {
		writeError(w, http.StatusBadRequest, "invalid filter: "+err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	client, mdb, err := mongoClientForService(svc)
	if err != nil {
		writeError(w, http.StatusBadGateway, "connect: "+err.Error())
		return
	}
	defer client.Disconnect(context.Background()) //nolint:errcheck

	res, err := mdb.Collection(colName).DeleteOne(ctx, filterDoc)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"deleted_count": res.DeletedCount,
	})
}

// handleMongoShell runs an arbitrary MongoDB command document via db.RunCommand.
// POST /services/{serviceId}/mongo/shell
// Body: {"command": {"find": "users", "filter": {}, "limit": 10}}
func (s *Server) handleMongoShell(w http.ResponseWriter, r *http.Request) {
	svc, err := s.resolveMongoService(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	var body struct {
		Command json.RawMessage `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Command == nil {
		writeError(w, http.StatusBadRequest, "command required")
		return
	}

	var cmdDoc bson.D
	if err := bson.UnmarshalExtJSON(body.Command, true, &cmdDoc); err != nil {
		writeError(w, http.StatusBadRequest, "invalid command: "+err.Error())
		return
	}

	if len(cmdDoc) == 0 {
		writeError(w, http.StatusBadRequest, "empty command")
		return
	}

	blocked := map[string]bool{
		"shutdown": true, "fsync": true, "repairDatabase": true,
		"copydb": true, "clone": true,
	}
	if blocked[fmt.Sprintf("%v", cmdDoc[0].Key)] {
		writeError(w, http.StatusForbidden, "command not allowed")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	client, mdb, err := mongoClientForService(svc)
	if err != nil {
		writeError(w, http.StatusBadGateway, "connect: "+err.Error())
		return
	}
	defer client.Disconnect(context.Background()) //nolint:errcheck

	start := time.Now()
	sr := mdb.RunCommand(ctx, cmdDoc)
	durationMs := time.Since(start).Milliseconds()

	if sr.Err() != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"error":       sr.Err().Error(),
			"duration_ms": durationMs,
		})
		return
	}

	var raw bson.M
	sr.Decode(&raw) //nolint:errcheck

	b, _ := bson.MarshalExtJSON(raw, false, true)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"result":      json.RawMessage(b),
		"duration_ms": durationMs,
	})
}
