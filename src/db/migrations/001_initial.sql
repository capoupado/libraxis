CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  lineage_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('prompt','run','mistake','lesson','note','skill')),
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  parent_id TEXT REFERENCES entries(id),
  version_number INTEGER NOT NULL CHECK(version_number >= 1),
  is_latest INTEGER NOT NULL DEFAULT 1 CHECK(is_latest IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_entries_lineage_version
  ON entries(lineage_id, version_number);

CREATE UNIQUE INDEX IF NOT EXISTS ux_entries_lineage_latest
  ON entries(lineage_id)
  WHERE is_latest = 1;

CREATE INDEX IF NOT EXISTS ix_entries_type ON entries(type);
CREATE INDEX IF NOT EXISTS ix_entries_created_at ON entries(created_at DESC);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

CREATE TABLE IF NOT EXISTS entry_links (
  id TEXT PRIMARY KEY,
  source_entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  target_entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS ix_entry_links_source ON entry_links(source_entry_id);
CREATE INDEX IF NOT EXISTS ix_entry_links_target ON entry_links(target_entry_id);

CREATE TABLE IF NOT EXISTS skill_proposals (
  id TEXT PRIMARY KEY,
  skill_lineage_id TEXT NOT NULL,
  proposer TEXT NOT NULL,
  proposal_markdown TEXT NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  decision_notes TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS ix_skill_proposals_status ON skill_proposals(status, created_at DESC);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT NOT NULL,
  is_revoked INTEGER NOT NULL DEFAULT 0 CHECK(is_revoked IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_api_keys_name ON api_keys(name);

CREATE TABLE IF NOT EXISTS web_sessions (
  id TEXT PRIMARY KEY,
  owner_username TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  csrf_token TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  entry_id UNINDEXED,
  title,
  body_markdown,
  content=''
);

CREATE TRIGGER IF NOT EXISTS entries_ai_fts
AFTER INSERT ON entries
BEGIN
  INSERT INTO entries_fts(entry_id, title, body_markdown)
  VALUES (new.id, new.title, new.body_markdown);
END;

CREATE TRIGGER IF NOT EXISTS entries_au_fts
AFTER UPDATE ON entries
BEGIN
  DELETE FROM entries_fts WHERE entry_id = old.id;
  INSERT INTO entries_fts(entry_id, title, body_markdown)
  VALUES (new.id, new.title, new.body_markdown);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad_fts
AFTER DELETE ON entries
BEGIN
  DELETE FROM entries_fts WHERE entry_id = old.id;
END;
