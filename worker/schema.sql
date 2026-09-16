PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  login TEXT PRIMARY KEY COLLATE NOCASE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('owner','admin','instructor')) DEFAULT 'instructor',
  password_hash TEXT,
  password_salt TEXT,
  legacy_hash TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  force_password_change INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  login TEXT NOT NULL REFERENCES users(login) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  owner_login TEXT NOT NULL COLLATE NOCASE,
  cancelled INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deleted_events (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  owner_login TEXT NOT NULL COLLATE NOCASE,
  deleted_at TEXT NOT NULL,
  deleted_by TEXT NOT NULL COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  owner_login TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  snapshot TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discord_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sent INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_events_updated ON events(updated_at);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_backups_at ON backups(at DESC);
