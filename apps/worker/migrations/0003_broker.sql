-- Arena to Tab A8 Command Broker
CREATE TABLE IF NOT EXISTS broker_commands (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  command TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','done','failed')),
  result TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  done_at INTEGER,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_broker_device_status ON broker_commands(device_id, status);
CREATE INDEX IF NOT EXISTS idx_broker_created_at ON broker_commands(created_at);
