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

// ─── Directional link reads ───────────────────────────────────────────────────

export function listOutgoingLinks(db: Database.Database, entryId: string): EntryLinkRow[] {
  return db
    .prepare<[string], EntryLinkRow>(
      `SELECT * FROM entry_links WHERE source_entry_id = ? ORDER BY created_at DESC`
    )
    .all(entryId);
}

export function listIncomingLinks(db: Database.Database, entryId: string): EntryLinkRow[] {
  return db
    .prepare<[string], EntryLinkRow>(
      `SELECT * FROM entry_links WHERE target_entry_id = ? ORDER BY created_at DESC`
    )
    .all(entryId);
}

// ─── Neighborhood traversal ───────────────────────────────────────────────────

export interface TraversalNode {
  node_id: string;
  depth: number;
}

export interface TraversalResult {
  nodes: TraversalNode[];
  edges: EntryLinkRow[];
}

export function traverseNeighborhood(
  db: Database.Database,
  rootId: string,
  opts: { depth: number; relationTypes?: string[]; direction: "out" | "in" | "both" }
): TraversalResult {
  const { depth, direction, relationTypes } = opts;

  // Build optional relation_type filter clause
  let relationFilter = "";
  const relationParams: string[] = [];
  if (relationTypes && relationTypes.length > 0) {
    const placeholders = relationTypes.map(() => "?").join(", ");
    relationFilter = `AND el.relation_type IN (${placeholders})`;
    relationParams.push(...relationTypes);
  }

  const sql = `
    WITH RECURSIVE walk(node_id, depth, path) AS (
      SELECT ?, 0, ',' || ? || ','
      UNION ALL
      SELECT
        CASE WHEN el.source_entry_id = w.node_id
             THEN el.target_entry_id
             ELSE el.source_entry_id END,
        w.depth + 1,
        w.path || CASE WHEN el.source_entry_id = w.node_id
                       THEN el.target_entry_id
                       ELSE el.source_entry_id END || ','
      FROM walk w
      JOIN entry_links el
        ON (
          (? = 'out'  AND el.source_entry_id = w.node_id) OR
          (? = 'in'   AND el.target_entry_id = w.node_id) OR
          (? = 'both' AND (el.source_entry_id = w.node_id OR el.target_entry_id = w.node_id))
        )
        ${relationFilter}
      WHERE w.depth < ?
        AND instr(w.path, ',' || CASE WHEN el.source_entry_id = w.node_id
                                      THEN el.target_entry_id
                                      ELSE el.source_entry_id END || ',') = 0
    )
    SELECT DISTINCT node_id, MIN(depth) as depth FROM walk GROUP BY node_id
  `;

  const params: (string | number)[] = [
    rootId,       // seed node_id
    rootId,       // seed path
    direction,    // 'out' check
    direction,    // 'in' check
    direction,    // 'both' check
    ...relationParams,
    depth,        // depth limit
  ];

  const nodes = db.prepare<(string | number)[], TraversalNode>(sql).all(...params);

  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Collect all discovered node ids to fetch spanning edges
  const nodeIds = nodes.map((n) => n.node_id);
  const edgePlaceholders = nodeIds.map(() => "?").join(", ");
  const edges = db
    .prepare<string[], EntryLinkRow>(
      `SELECT * FROM entry_links
       WHERE source_entry_id IN (${edgePlaceholders})
          OR target_entry_id IN (${edgePlaceholders})`
    )
    .all(...nodeIds, ...nodeIds);

  return { nodes, edges };
}

// ─── SuggestedLink types and CRUD ─────────────────────────────────────────────

export interface SuggestedLinkRow {
  id: string;
  source_entry_id: string;
  target_entry_id: string;
  signal: string;
  score: number;
  relation_type: string | null;
  rationale: string | null;
  generated_at: string;
}

export interface UpsertSuggestedLinkInput {
  sourceEntryId: string;
  targetEntryId: string;
  signal: string; // 'tag' | 'fts' | 'embedding'
  score: number;
  rationale?: string;
}

export function listSuggestedLinks(
  db: Database.Database,
  sourceEntryId?: string
): SuggestedLinkRow[] {
  if (sourceEntryId !== undefined) {
    return db
      .prepare<[string], SuggestedLinkRow>(
        `SELECT * FROM suggested_links WHERE source_entry_id = ? ORDER BY score DESC`
      )
      .all(sourceEntryId);
  }
  return db
    .prepare<[], SuggestedLinkRow>(`SELECT * FROM suggested_links ORDER BY score DESC`)
    .all();
}

export function upsertSuggestedLink(
  db: Database.Database,
  input: UpsertSuggestedLinkInput
): void {
  const id = ulid();
  db.prepare(
    `
      INSERT INTO suggested_links(id, source_entry_id, target_entry_id, signal, score, rationale)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_entry_id, target_entry_id, signal)
      DO UPDATE SET
        score = excluded.score,
        rationale = excluded.rationale,
        generated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `
  ).run(
    id,
    input.sourceEntryId,
    input.targetEntryId,
    input.signal,
    input.score,
    input.rationale ?? null
  );
}

export function deleteSuggestedLink(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM suggested_links WHERE id = ?`).run(id);
}

export function promoteSuggestedLink(
  db: Database.Database,
  id: string,
  relationType: string,
  createdBy: string
): string {
  let newLinkId = "";

  const promote = db.transaction(() => {
    const row = db
      .prepare<[string], SuggestedLinkRow>(`SELECT * FROM suggested_links WHERE id = ?`)
      .get(id);

    if (!row) {
      throw new Error(`Suggested link not found: ${id}`);
    }

    newLinkId = createEntryLink(db, {
      sourceEntryId: row.source_entry_id,
      targetEntryId: row.target_entry_id,
      relationType,
      createdBy,
    });

    db.prepare(`DELETE FROM suggested_links WHERE id = ?`).run(id);
  });

  promote();
  return newLinkId;
}
