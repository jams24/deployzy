package proxy

import (
	"context"

	"github.com/serverme/serverme/server/internal/db"
)

// DBDomainResolver implements DomainResolver using the database.
type DBDomainResolver struct {
	db *db.DB
}

// NewDBDomainResolver creates a domain resolver backed by the database.
func NewDBDomainResolver(database *db.DB) *DBDomainResolver {
	return &DBDomainResolver{db: database}
}

// ResolveDomain looks up a verified custom domain and returns its routing target.
func (r *DBDomainResolver) ResolveDomain(hostname string) (string, string, bool) {
	return r.db.LookupVerifiedDomain(context.Background(), hostname)
}
