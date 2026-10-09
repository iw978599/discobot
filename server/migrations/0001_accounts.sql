-- Everything the accounts API stores. No email addresses, names or IP addresses.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  is_owner INTEGER NOT NULL DEFAULT 0,
  invite_code TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_by TEXT,
  used_at INTEGER
);

-- Failed sign-in and recovery attempts, kept for fifteen minutes to slow password guessing.
CREATE TABLE sign_in_failures (
  username_key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX sign_in_failures_user ON sign_in_failures (username_key, at);
