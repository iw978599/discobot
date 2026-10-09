-- Published songs: a public, read-only copy of a project behind a short code.
-- Publishing the same project again replaces the copy and keeps the code.
CREATE TABLE songs (
  code TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  UNIQUE (owner_id, project_id)
);
