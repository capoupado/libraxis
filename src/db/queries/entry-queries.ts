import type Database from "better-sqlite3";

export type EntryType = "prompt" | "run" | "mistake" | "lesson" | "note" | "skill" | "user" | "feedback" | "project" | "reference";

export interface EntryRow {
  id: string;
  lineage_id: string;
  type: EntryType;
  title: string;
  body_markdown: string;
  metadata_json: string;
  status: "active" | "archived";
  parent_id: string | null;
  version_number: number;
  is_latest: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateEntryInput {
  id: string;
  lineageId: string;
  type: EntryType;
  title: string;
  bodyMarkdown: string;
  metadataJson: string;
  parentId?: string | null;
  versionNumber: number;
  createdBy: string;
}

export function createEntry(db: Database.Database, input: CreateEntryInput): void {
  db.prepare(
    `
      INSERT INTO entries (
        id, lineage_id, type, title, body_markdown, metadata_json,
        parent_id, version_number, is_latest, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `
  ).run(
    input.id,
    input.lineageId,
    input.type,
    input.title,
    input.bodyMarkdown,
    input.metadataJson,
    input.parentId ?? null,
    input.versionNumber,
    input.createdBy
  );
}

export function markPreviousVersionsNotLatest(db: Database.Database, lineageId: string): void {
  db.prepare("UPDATE entries SET is_latest = 0 WHERE lineage_id = ? AND is_latest = 1").run(lineageId);
}

export function getEntryById(db: Database.Database, id: string): EntryRow | undefined {
  return db.prepare<string, EntryRow>("SELECT * FROM entries WHERE id = ?").get(id);
}

export function getLatestEntryByLineage(
  db: Database.Database,
  lineageId: string
): EntryRow | undefined {
  return db
    .prepare<string, EntryRow>("SELECT * FROM entries WHERE lineage_id = ? AND is_latest = 1")
    .get(lineageId);
}

export function listLatestEntries(db: Database.Database, limit: number, offset: number): EntryRow[] {
  return db
    .prepare<[number, number], EntryRow>(
      `
        SELECT *
        FROM entries
        WHERE is_latest = 1
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `
    )
    .all(limit, offset);
}

export function listEntryHistory(db: Database.Database, lineageId: string): EntryRow[] {
  return db
    .prepare<string, EntryRow>(
      "SELECT * FROM entries WHERE lineage_id = ? ORDER BY version_number DESC"
    )
    .all(lineageId);
}

export interface FtsSearchResult {
  id: string;
  lineage_id: string;
  type: EntryType;
  title: string;
  body_markdown: string;
  score: number;
}

export function searchEntriesFts(
  db: Database.Database,
  query: string,
  opts?: { types?: string[]; limit?: number }
): FtsSearchResult[] {
  const sanitized = query.replace(/[^\w\s]/g, " ").trim();
  if (!sanitized) return [];

  const limit = opts?.limit ?? 20;
  const types = opts?.types;

  let typeFilter = "";
  const typeParams: string[] = [];
  if (types && types.length > 0) {
    const placeholders = types.map(() => "?").join(", ");
    typeFilter = `AND e.type IN (${placeholders})`;
    typeParams.push(...types);
  }

  const sql = `
    SELECT e.id, e.lineage_id, e.title, e.type, e.body_markdown,
           -bm25(entries_fts) AS score
    FROM entries_fts f
    JOIN entries e ON e.rowid = f.rowid
    WHERE entries_fts MATCH ?
      AND e.is_latest = 1
      ${typeFilter}
    ORDER BY score DESC
    LIMIT ?
  `;

  return db
    .prepare<(string | number)[], FtsSearchResult>(sql)
    .all(sanitized, ...typeParams, limit);
}

export interface LineageDiagnosis {
  kind: "not_found" | "is_entry_id" | "orphan";
  actualLineageId?: string;
}

export function diagnoseLineageLookup(
  db: Database.Database,
  candidate: string
): LineageDiagnosis {
  const byId = db
    .prepare<string, { lineage_id: string }>("SELECT lineage_id FROM entries WHERE id = ? LIMIT 1")
    .get(candidate);
  if (byId) return { kind: "is_entry_id", actualLineageId: byId.lineage_id };

  const anyVersion = db
    .prepare<string, { id: string }>("SELECT id FROM entries WHERE lineage_id = ? LIMIT 1")
    .get(candidate);
  if (anyVersion) return { kind: "orphan" };

  return { kind: "not_found" };
}

export function archiveEntryLineage(db: Database.Database, lineageId: string): number {
  const result = db
    .prepare(
      `
        UPDATE entries
        SET status = 'archived',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE lineage_id = ?
          AND status != 'archived'
      `
    )
    .run(lineageId);

  return Number(result.changes ?? 0);
}
