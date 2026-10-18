CREATE TABLE users (
  id TEXT PRIMARY KEY,
  oauth_provider TEXT NOT NULL,
  oauth_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(oauth_provider, oauth_sub)
);

CREATE TABLE provider_prefs (
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK(length(provider_id) BETWEEN 1 AND 64 AND provider_id NOT LIKE '%:%'),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  selected_model TEXT CHECK(selected_model IS NULL OR selected_model NOT LIKE '%:%'),
  priority_mode TEXT NOT NULL CHECK(priority_mode IN ('latency','reliability','budget','balanced')),
  cost_weight INTEGER NOT NULL CHECK(cost_weight BETWEEN 0 AND 10),
  quota_hint_daily INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_provider_prefs_user ON provider_prefs(user_id);

CREATE TABLE role_assignments (
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ptm','vcm','fcm')),
  provider_id TEXT NOT NULL CHECK(length(provider_id) BETWEEN 1 AND 64 AND provider_id NOT LIKE '%:%'),
  model_id TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 128 AND model_id NOT LIKE '%:%'),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, role),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_role_assignments_user ON role_assignments(user_id);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  request_id TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('ok','error','blocked')),
  latency_ms INTEGER,
  token_estimate INTEGER,
  cost_estimate REAL,
  phase TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_events_user ON audit_events(user_id);
