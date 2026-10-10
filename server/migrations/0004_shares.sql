-- Projects an account has shared with other accounts, so two people can take turns on one.
-- A member can read and save the owner's copy; only the owner can share, unshare or delete it.
-- Nothing is stored about a person here beyond which account it is.
CREATE TABLE project_shares (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, project_id, member_id)
);
CREATE INDEX project_shares_member ON project_shares (member_id);

-- Which account saved a project last, so the people sharing it can see whose turn it was.
ALTER TABLE projects ADD COLUMN updated_by TEXT;
