CREATE TABLE IF NOT EXISTS suggested_links (
  id TEXT PRIMARY KEY,
  source_entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  target_entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  signal TEXT NOT NULL CHECK(signal IN ('tag','fts','embedding')),
  score REAL NOT NULL,
  relation_type TEXT,
  rationale TEXT,
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (source_entry_id <> target_entry_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_suggested_links_triple
  ON suggested_links(source_entry_id, target_entry_id, signal);
CREATE INDEX IF NOT EXISTS ix_suggested_links_source
  ON suggested_links(source_entry_id, score DESC);
CREATE INDEX IF NOT EXISTS ix_suggested_links_target
  ON suggested_links(target_entry_id);

CREATE INDEX IF NOT EXISTS ix_entry_links_relation_type
  ON entry_links(relation_type);
CREATE INDEX IF NOT EXISTS ix_entry_links_source_relation
  ON entry_links(source_entry_id, relation_type);
