import type Database from "better-sqlite3";

export interface TagRelatedRow {
  entry_id: string;
  jaccard: number;
}

export function findRelatedByTags(
  db: Database.Database,
  entryId: string,
  limit: number
): TagRelatedRow[] {
  return db
    .prepare<[string, string, number], TagRelatedRow>(
      `
      WITH src_tags AS (
        SELECT tag_id FROM entry_tags WHERE entry_id = ?
      ),
      src_cnt AS (
        SELECT COUNT(*) AS c FROM src_tags
      )
      SELECT
        et.entry_id,
        CAST(COUNT(*) AS REAL) / (src_cnt.c + (SELECT COUNT(*) FROM entry_tags WHERE entry_id = et.entry_id) - COUNT(*)) AS jaccard
      FROM entry_tags et, src_cnt
      WHERE et.tag_id IN (SELECT tag_id FROM src_tags)
        AND et.entry_id <> ?
      GROUP BY et.entry_id
      ORDER BY jaccard DESC
      LIMIT ?
      `
    )
    .all(entryId, entryId, limit);
}

export interface FtsRelatedRow {
  entry_id: string;
  score: number;
}

export function findRelatedByFts(
  db: Database.Database,
  entryId: string,
  limit: number
): FtsRelatedRow[] {
  const row = db
    .prepare<[string], { title: string }>(`SELECT title FROM entries WHERE id = ?`)
    .get(entryId);

  if (!row) return [];

  const sanitized = row.title.replace(/[^\w\s]/g, " ").trim();
  if (sanitized === "") return [];

  // Build an OR query so any word in the title can match other entries.
  // FTS5 default is AND, which requires all words; OR gives broader related results.
  const words = sanitized.split(/\s+/).filter(Boolean);
  const matchExpr = words.join(" OR ");

  // entries_fts uses content='' (contentless), so column values are not stored.
  // Join back to entries via rowid to retrieve the real entry_id.
  return db
    .prepare<[string, string, number], FtsRelatedRow>(
      `
      SELECT e.id AS entry_id, -bm25(entries_fts) AS score
      FROM entries_fts
      JOIN entries e ON e.rowid = entries_fts.rowid
      WHERE entries_fts MATCH ?
        AND e.id <> ?
      ORDER BY score DESC
      LIMIT ?
      `
    )
    .all(matchExpr, entryId, limit);
}
