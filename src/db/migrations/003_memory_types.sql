-- Expand the entries.type CHECK constraint to include AI agent memory types.
-- SQLite 3.26.0+ auto-rewrites FK references in child tables when a parent
-- table is renamed. To avoid corrupting entry_tags and entry_links schemas,
-- we save their data, drop them, do the entries recreation, then rebuild them.
-- At the point of rename, no other table holds an FK ref to entries (except
-- entries.parent_id, which is self-referential and handled correctly).

-- Step 1: Save child-table data before dropping the tables.
CREATE TEMPORARY TABLE IF NOT EXISTS _tmp_entry_tags AS SELECT * FROM entry_tags;
CREATE TEMPORARY TABLE IF NOT EXISTS _tmp_entry_links AS SELECT * FROM entry_links;

-- Step 2: Drop child tables so no FK ref to entries remains.
DROP TABLE entry_tags;
DROP TABLE entry_links;

-- Step 3: Drop FTS triggers and virtual table (they reference entries by name).
DROP TRIGGER IF EXISTS entries_ai_fts;
DROP TRIGGER IF EXISTS entries_au_fts;
DROP TRIGGER IF EXISTS entries_ad_fts;
DROP TABLE IF EXISTS entries_fts;

-- Step 4: Rename and recreate entries with expanded type CHECK.
ALTER TABLE entries RENAME TO entries_old;

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  lineage_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    'prompt','run','mistake','lesson','note','skill',
    'user','feedback','project','reference'
  )),
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

INSERT INTO entries SELECT * FROM entries_old;
DROP TABLE entries_old;

-- Step 5: Recreate indexes on entries.
CREATE UNIQUE INDEX IF NOT EXISTS ux_entries_lineage_version
  ON entries(lineage_id, version_number);

CREATE UNIQUE INDEX IF NOT EXISTS ux_entries_lineage_latest
  ON entries(lineage_id)
  WHERE is_latest = 1;

CREATE INDEX IF NOT EXISTS ix_entries_type ON entries(type);
CREATE INDEX IF NOT EXISTS ix_entries_created_at ON entries(created_at DESC);

-- Step 6: Restore child tables with FK refs pointing at the new entries table.
CREATE TABLE entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

INSERT INTO entry_tags SELECT * FROM _tmp_entry_tags;
DROP TABLE _tmp_entry_tags;

CREATE TABLE entry_links (
  id TEXT PRIMARY KEY,
  source_entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  target_entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO entry_links SELECT * FROM _tmp_entry_links;
DROP TABLE _tmp_entry_links;

CREATE INDEX IF NOT EXISTS ix_entry_links_source ON entry_links(source_entry_id);
CREATE INDEX IF NOT EXISTS ix_entry_links_target ON entry_links(target_entry_id);

-- Step 7: Recreate FTS virtual table and triggers.
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

INSERT INTO entries_fts(entry_id, title, body_markdown)
  SELECT id, title, body_markdown FROM entries;
