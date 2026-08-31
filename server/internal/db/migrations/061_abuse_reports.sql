-- +goose Up
-- Public abuse reports (phishing, malware, spam, illegal content) against a
-- deployed app / tunnel / custom domain. Anyone can file one; admins triage.
CREATE TABLE IF NOT EXISTS abuse_reports (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_url    TEXT NOT NULL,               -- the reported URL / subdomain
    category      TEXT NOT NULL DEFAULT 'other',-- phishing | malware | spam | illegal | other
    details       TEXT NOT NULL DEFAULT '',
    reporter_email TEXT NOT NULL DEFAULT '',
    reporter_ip   TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'open', -- open | actioned | dismissed
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_abuse_reports_status ON abuse_reports(status, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS abuse_reports;
