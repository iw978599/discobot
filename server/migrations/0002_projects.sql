-- Synced projects: one row per project per account, holding the project file as JSON.
-- A deleted project keeps its row (with no data) so other browsers learn it was deleted.
CREATE TABLE projects (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  PRIMARY KEY (owner_id, id)
);
