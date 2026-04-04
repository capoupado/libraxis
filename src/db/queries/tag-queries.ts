import type Database from "better-sqlite3";

import { ulid } from "ulid";

interface TagRow {
  id: string;
  name: string;
}

export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase();
}

export function ensureTag(db: Database.Database, tagName: string): TagRow {
  const normalized = normalizeTagName(tagName);
  const existing = db.prepare<string, TagRow>("SELECT * FROM tags WHERE name = ?").get(normalized);

  if (existing) {
    return existing;
  }

  const newTag: TagRow = {
    id: ulid(),
    name: normalized
  };

  db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").run(newTag.id, newTag.name);
  return newTag;
}

export function attachTagToEntry(db: Database.Database, entryId: string, tagName: string): void {
  const tag = ensureTag(db, tagName);
  db.prepare("INSERT OR IGNORE INTO entry_tags(entry_id, tag_id) VALUES (?, ?)").run(entryId, tag.id);
}

export function detachTagFromEntry(db: Database.Database, entryId: string, tagName: string): void {
  const normalized = normalizeTagName(tagName);
  const tag = db.prepare<string, TagRow>("SELECT * FROM tags WHERE name = ?").get(normalized);

  if (!tag) {
    return;
  }

  db.prepare("DELETE FROM entry_tags WHERE entry_id = ? AND tag_id = ?").run(entryId, tag.id);
}

export function listTagsForEntry(db: Database.Database, entryId: string): string[] {
  const rows = db
    .prepare<string, { name: string }>(
      `
        SELECT t.name
        FROM tags t
        INNER JOIN entry_tags et ON et.tag_id = t.id
        WHERE et.entry_id = ?
        ORDER BY t.name ASC
      `
    )
    .all(entryId);

  return rows.map((row: { name: string }) => row.name);
}
