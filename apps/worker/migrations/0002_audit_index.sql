-- 0002_audit_index.sql — the audit trail is read newest-first.
-- Metadata-only, same rule as 0001: this migration adds an index, never a
-- content-bearing column (no prompts, outputs, headers, cookies or keys).
CREATE INDEX idx_audit_events_created ON audit_events(created_at);
