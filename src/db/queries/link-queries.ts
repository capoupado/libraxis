import type Database from "better-sqlite3";

import { ulid } from "ulid";

export interface EntryLinkRow {
  id: string;
  source_entry_id: string;
  target_entry_id: string;
  relation_type: string;
  created_by: string;
  created_at: string;
}

export interface CreateEntryLinkInput {
  sourceEntryId: string;
  targetEntryId: string;
  relationType: string;
  createdBy: string;
}

export function createEntryLink(db: Database.Database, input: CreateEntryLinkInput): string {
  const id = ulid();
  db.prepare(
    `
      INSERT INTO entry_links(
        id, source_entry_id, target_entry_id, relation_type, created_by
      ) VALUES (?, ?, ?, ?, ?)
    `
  ).run(id, input.sourceEntryId, input.targetEntryId, input.relationType, input.createdBy);

  return id;
}

export function listLinksForEntry(db: Database.Database, entryId: string): EntryLinkRow[] {
  return db
    .prepare<[string, string], EntryLinkRow>(
      `
        SELECT *
        FROM entry_links
        WHERE source_entry_id = ? OR target_entry_id = ?
        ORDER BY created_at DESC
      `
    )
    .all(entryId, entryId);
}
