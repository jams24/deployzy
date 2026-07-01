package db

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// User represents a registered user.
type User struct {
	ID           string     `json:"id"`
	Email        string     `json:"email"`
	Name         string     `json:"name"`
	PasswordHash string     `json:"-"`
	Plan         string     `json:"plan"` // effective plan (base, or "pro" while a referral reward is active)
	ProUntil     *time.Time `json:"pro_until"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// APIKey represents an API key for SDK/CLI authentication.
type APIKey struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`     // e.g., "sm_live_a1b2"
	TokenHash  string     `json:"-"`          // SHA-256 of full token
	Scope      string     `json:"scope"`      // "read" | "deploy" | "full"
	LastUsedAt *time.Time `json:"last_used_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

// Domain represents a custom domain.
type Domain struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	Domain          string    `json:"domain"`
	Verified        bool      `json:"verified"`
	CnameTarget     string    `json:"cname_target"`
	TargetType      string    `json:"target_type"`      // "tunnel" or "project"
	TargetSubdomain string    `json:"target_subdomain"` // subdomain to route to
	CreatedAt       time.Time `json:"created_at"`
}

// ReservedSubdomain represents a reserved subdomain.
type ReservedSubdomain struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Subdomain string    `json:"subdomain"`
	CreatedAt time.Time `json:"created_at"`
}

// Team represents a team.
type Team struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	OwnerID   string    `json:"owner_id"`
	CreatedAt time.Time `json:"created_at"`
}

// TeamMember represents a team membership.
type TeamMember struct {
	TeamID   string    `json:"team_id"`
	UserID   string    `json:"user_id"`
	Role     string    `json:"role"`
	JoinedAt time.Time `json:"joined_at"`
}

// --- User operations ---

// CreateUser creates a new user with a hashed password.
func (d *DB) CreateUser(ctx context.Context, email, name, password string) (*User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	var u User
	err = d.Pool.QueryRow(ctx,
		`INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
		 RETURNING id, email, name, password_hash, plan, created_at, updated_at`,
		email, name, string(hash),
	).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.Plan, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("insert user: %w", err)
	}
	return &u, nil
}

// GetUserByEmail looks up a user by email.
func (d *DB) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	var u User
	err := d.Pool.QueryRow(ctx,
		`SELECT id, email, name, password_hash, plan, pro_until, created_at, updated_at FROM users WHERE email = $1`,
		email,
	).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.Plan, &u.ProUntil, &u.CreatedAt, &u.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	u.Plan = effectivePlan(u.Plan, u.ProUntil)
	return &u, nil
}

// GetUserByID looks up a user by ID.
func (d *DB) GetUserByID(ctx context.Context, id string) (*User, error) {
	var u User
	err := d.Pool.QueryRow(ctx,
		`SELECT id, email, name, password_hash, plan, pro_until, created_at, updated_at FROM users WHERE id = $1`,
		id,
	).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.Plan, &u.ProUntil, &u.CreatedAt, &u.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	u.Plan = effectivePlan(u.Plan, u.ProUntil)
	return &u, nil
}

// DeleteUser permanently deletes a user and all associated data (cascades via FK).
func (d *DB) DeleteUser(ctx context.Context, userID string) error {
	_, err := d.Pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	return err
}

// CheckPassword verifies a password against the stored hash.
func (u *User) CheckPassword(password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) == nil
}

// --- API Key operations ---

// ValidScope reports whether s is one of the allowed API-key scopes.
func ValidScope(s string) bool {
	return s == "read" || s == "deploy" || s == "full"
}

// GenerateAPIKey creates a new API key and returns the full token (only shown once).
// scope must be one of "read"|"deploy"|"full" (empty defaults to "full").
func (d *DB) GenerateAPIKey(ctx context.Context, userID, name, scope string) (fullToken string, key *APIKey, err error) {
	if scope == "" {
		scope = "full"
	}
	// Generate random token: sm_live_ + 32 random hex chars
	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", nil, fmt.Errorf("generate token: %w", err)
	}

	fullToken = "sm_live_" + hex.EncodeToString(tokenBytes)
	prefix := fullToken[:16] // "sm_live_a1b2c3d4"

	hash := sha256.Sum256([]byte(fullToken))
	tokenHash := hex.EncodeToString(hash[:])

	var k APIKey
	err = d.Pool.QueryRow(ctx,
		`INSERT INTO api_keys (user_id, name, token_hash, prefix, scope)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, user_id, name, prefix, token_hash, scope, last_used_at, created_at`,
		userID, name, tokenHash, prefix, scope,
	).Scan(&k.ID, &k.UserID, &k.Name, &k.Prefix, &k.TokenHash, &k.Scope, &k.LastUsedAt, &k.CreatedAt)
	if err != nil {
		return "", nil, fmt.Errorf("insert api_key: %w", err)
	}

	return fullToken, &k, nil
}

// ValidateAPIKey checks an API key token and returns the associated user plus the
// key's scope ("read"|"deploy"|"full"). Scope is "" when the key is invalid.
func (d *DB) ValidateAPIKey(ctx context.Context, token string) (*User, string, error) {
	hash := sha256.Sum256([]byte(token))
	tokenHash := hex.EncodeToString(hash[:])

	// Update last_used_at and get user_id + scope
	var userID, scope string
	err := d.Pool.QueryRow(ctx,
		`UPDATE api_keys SET last_used_at = now() WHERE token_hash = $1 RETURNING user_id, COALESCE(scope, 'full')`,
		tokenHash,
	).Scan(&userID, &scope)
	if err == pgx.ErrNoRows {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}

	u, err := d.GetUserByID(ctx, userID)
	return u, scope, err
}

// ListAPIKeys returns all API keys for a user (without the actual token).
func (d *DB) ListAPIKeys(ctx context.Context, userID string) ([]APIKey, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT id, user_id, name, prefix, COALESCE(scope, 'full'), last_used_at, created_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []APIKey
	for rows.Next() {
		var k APIKey
		if err := rows.Scan(&k.ID, &k.UserID, &k.Name, &k.Prefix, &k.Scope, &k.LastUsedAt, &k.CreatedAt); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, nil
}

// DeleteAPIKey deletes an API key by ID (only if owned by the user).
func (d *DB) DeleteAPIKey(ctx context.Context, userID, keyID string) error {
	tag, err := d.Pool.Exec(ctx,
		`DELETE FROM api_keys WHERE id = $1 AND user_id = $2`, keyID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("api key not found")
	}
	return nil
}

// --- Domain operations ---

// CreateDomain registers a custom domain for a user.
func (d *DB) CreateDomain(ctx context.Context, userID, domainName, cnameTarget string) (*Domain, error) {
	var dom Domain
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO domains (user_id, domain, cname_target) VALUES ($1, $2, $3)
		 RETURNING id, user_id, domain, verified, cname_target, target_type, target_subdomain, created_at`,
		userID, domainName, cnameTarget,
	).Scan(&dom.ID, &dom.UserID, &dom.Domain, &dom.Verified, &dom.CnameTarget, &dom.TargetType, &dom.TargetSubdomain, &dom.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &dom, nil
}

// VerifyDomain marks a domain as verified.
func (d *DB) VerifyDomain(ctx context.Context, domainID string) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE domains SET verified = true WHERE id = $1`, domainID)
	return err
}

// ListDomains returns all domains for a user.
func (d *DB) ListDomains(ctx context.Context, userID string) ([]Domain, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT id, user_id, domain, verified, cname_target, target_type, target_subdomain, created_at FROM domains WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var domains []Domain
	for rows.Next() {
		var dom Domain
		if err := rows.Scan(&dom.ID, &dom.UserID, &dom.Domain, &dom.Verified, &dom.CnameTarget, &dom.TargetType, &dom.TargetSubdomain, &dom.CreatedAt); err != nil {
			return nil, err
		}
		domains = append(domains, dom)
	}
	return domains, nil
}

// ListDomainsForUsers returns all domains for multiple users (team context).
func (d *DB) ListDomainsForUsers(ctx context.Context, userIDs []string) ([]Domain, error) {
	if len(userIDs) == 0 {
		return []Domain{}, nil
	}
	rows, err := d.Pool.Query(ctx,
		`SELECT id, user_id, domain, verified, cname_target, target_type, target_subdomain, created_at 
		 FROM domains WHERE user_id = ANY($1) ORDER BY created_at DESC`,
		userIDs,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var domains []Domain
	for rows.Next() {
		var dom Domain
		if err := rows.Scan(&dom.ID, &dom.UserID, &dom.Domain, &dom.Verified, &dom.CnameTarget, &dom.TargetType, &dom.TargetSubdomain, &dom.CreatedAt); err != nil {
			return nil, err
		}
		domains = append(domains, dom)
	}
	return domains, nil
}

// DeleteDomainForUsers deletes a custom domain for any of the given user IDs.
func (d *DB) DeleteDomainForUsers(ctx context.Context, userIDs []string, domainID string) error {
	tag, err := d.Pool.Exec(ctx,
		`DELETE FROM domains WHERE id = $1 AND user_id = ANY($2)`, domainID, userIDs)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("domain not found")
	}
	return nil
}

// DeleteDomain deletes a custom domain.
func (d *DB) DeleteDomain(ctx context.Context, userID, domainID string) error {
	tag, err := d.Pool.Exec(ctx,
		`DELETE FROM domains WHERE id = $1 AND user_id = $2`, domainID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("domain not found")
	}
	return nil
}

// GetDomainByName looks up a domain by its name.
func (d *DB) GetDomainByName(ctx context.Context, domainName string) (*Domain, error) {
	var dom Domain
	err := d.Pool.QueryRow(ctx,
		`SELECT id, user_id, domain, verified, cname_target, target_type, target_subdomain, created_at FROM domains WHERE domain = $1`,
		domainName,
	).Scan(&dom.ID, &dom.UserID, &dom.Domain, &dom.Verified, &dom.CnameTarget, &dom.TargetType, &dom.TargetSubdomain, &dom.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &dom, nil
}

// LookupVerifiedDomain looks up a verified custom domain with a bound target for routing.
func (d *DB) LookupVerifiedDomain(ctx context.Context, hostname string) (targetType, targetSubdomain string, ok bool) {
	err := d.Pool.QueryRow(ctx,
		`SELECT target_type, target_subdomain FROM domains WHERE domain = $1 AND verified = true AND target_subdomain != ''`,
		hostname,
	).Scan(&targetType, &targetSubdomain)
	if err != nil {
		return "", "", false
	}
	return targetType, targetSubdomain, true
}

// BindDomain binds a verified domain to a tunnel or project subdomain.
func (d *DB) BindDomain(ctx context.Context, domainID, userID, targetType, targetSubdomain string) error {
	tag, err := d.Pool.Exec(ctx,
		`UPDATE domains SET target_type = $3, target_subdomain = $4 WHERE id = $1 AND user_id = $2 AND verified = true`,
		domainID, userID, targetType, targetSubdomain,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("domain not found or not verified")
	}
	return nil
}

// --- Reserved Subdomain operations ---

// ReserveSubdomain reserves a subdomain for a user.
func (d *DB) ReserveSubdomain(ctx context.Context, userID, subdomain string) (*ReservedSubdomain, error) {
	var rs ReservedSubdomain
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO reserved_subdomains (user_id, subdomain) VALUES ($1, $2)
		 RETURNING id, user_id, subdomain, created_at`,
		userID, subdomain,
	).Scan(&rs.ID, &rs.UserID, &rs.Subdomain, &rs.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &rs, nil
}

// GetReservedSubdomain checks if a subdomain is reserved and by whom.
func (d *DB) GetReservedSubdomain(ctx context.Context, subdomain string) (*ReservedSubdomain, error) {
	var rs ReservedSubdomain
	err := d.Pool.QueryRow(ctx,
		`SELECT id, user_id, subdomain, created_at FROM reserved_subdomains WHERE subdomain = $1`,
		subdomain,
	).Scan(&rs.ID, &rs.UserID, &rs.Subdomain, &rs.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rs, nil
}
