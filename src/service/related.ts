import type Database from "better-sqlite3";

import { getLatestEntryByLineage } from "../db/queries/entry-queries.js";
import {
  traverseNeighborhood,
  listIncomingLinks,
  upsertSuggestedLink,
  promoteSuggestedLink,
  type EntryLinkRow,
} from "../db/queries/link-queries.js";
import {
  findRelatedByTags,
  findRelatedByFts,
} from "../db/queries/related-queries.js";
import { validateDirection } from "./links.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface GraphNode {
  lineage_id: string;
  entry_id: string;
  title: string;
  type: string;
  depth: number;
}

export interface GraphEdge {
  source_lineage_id: string;
  target_lineage_id: string;
  relation_type: string;
  signal: "explicit" | "tag" | "fts";
  score: number;
}

export interface EntryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GetEntryGraphOptions {
  depth?: number;
  signals?: Array<'explicit' | 'tag' | 'fts'>;
  relationTypes?: string[];
  direction?: "out" | "in" | "both";
  limit?: number;
}

export interface SuggestOptions {
  signals?: ("tag" | "fts")[];
  topK?: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface EntryHydrated {
  id: string;
  lineage_id: string;
  title: string;
  type: string;
}

function hydrateEntries(
  db: Database.Database,
  entryIds: string[]
): Map<string, EntryHydrated> {
  if (entryIds.length === 0) return new Map();
  const placeholders = entryIds.map(() => "?").join(", ");
  const rows = db
    .prepare<string[], EntryHydrated>(
      `SELECT id, lineage_id, title, type FROM entries WHERE id IN (${placeholders})`
    )
    .all(...entryIds);
  const map = new Map<string, EntryHydrated>();
  for (const row of rows) {
    map.set(row.id, row);
  }
  return map;
}

// ─── getEntryGraph ────────────────────────────────────────────────────────────

export function getEntryGraph(
  db: Database.Database,
  rootLineageId: string,
  opts?: GetEntryGraphOptions
): EntryGraph {
  const depth = opts?.depth ?? 2;
  const signals = opts?.signals ?? ["explicit"];
  const relationTypes = opts?.relationTypes;
  const direction = opts?.direction ?? "both";
  const limit = opts?.limit ?? 50;

  // Resolve root lineage → latest entry_id
  const rootEntry = getLatestEntryByLineage(db, rootLineageId);
  if (!rootEntry) {
    return { nodes: [], edges: [] };
  }
  const rootEntryId = rootEntry.id;

  // Collect raw results per signal
  // Map: entry_id → { depth, signal, score, edgeRows? }
  const entryDepthMap = new Map<string, { depth: number; signal: "explicit" | "tag" | "fts"; score: number }>();
  const explicitEdgeRows: EntryLinkRow[] = [];

  // tag signal results: entry_id → jaccard
  const tagScores = new Map<string, number>();
  // fts signal results: entry_id → score
  const ftsScores = new Map<string, number>();

  if (signals.includes("explicit")) {
    const traversal = traverseNeighborhood(db, rootEntryId, {
      depth,
      relationTypes,
      direction,
    });
    for (const node of traversal.nodes) {
      if (node.node_id === rootEntryId) continue; // skip root
      const existing = entryDepthMap.get(node.node_id);
      if (!existing || node.depth < existing.depth) {
        entryDepthMap.set(node.node_id, {
          depth: node.depth,
          signal: "explicit",
          score: 1.0,
        });
      }
    }
    explicitEdgeRows.push(...traversal.edges);
  }

  if (signals.includes("tag")) {
    const tagRows = findRelatedByTags(db, rootEntryId, limit);
    for (const row of tagRows) {
      tagScores.set(row.entry_id, row.jaccard);
      if (!entryDepthMap.has(row.entry_id)) {
        entryDepthMap.set(row.entry_id, {
          depth: 1,
          signal: "tag",
          score: row.jaccard,
        });
      }
    }
  }

  if (signals.includes("fts")) {
    const ftsRows = findRelatedByFts(db, rootEntryId, limit);
    for (const row of ftsRows) {
      ftsScores.set(row.entry_id, row.score);
      if (!entryDepthMap.has(row.entry_id)) {
        entryDepthMap.set(row.entry_id, {
          depth: 1,
          signal: "fts",
          score: row.score,
        });
      }
    }
  }

  if (entryDepthMap.size === 0) {
    return { nodes: [], edges: [] };
  }

  // Hydrate all entry_ids (neighbors only, not root)
  const allEntryIds = Array.from(entryDepthMap.keys());
  // Also hydrate root for lineage resolution in explicit edges
  const hydrationIds = [rootEntryId, ...allEntryIds];
  const hydratedMap = hydrateEntries(db, hydrationIds);

  // Build node map keyed by lineage_id — deduplicate by smallest depth
  const nodesByLineage = new Map<string, GraphNode>();

  for (const [entryId, info] of entryDepthMap) {
    const hydrated = hydratedMap.get(entryId);
    if (!hydrated) continue;

    const existing = nodesByLineage.get(hydrated.lineage_id);
    if (!existing || info.depth < existing.depth) {
      nodesByLineage.set(hydrated.lineage_id, {
        lineage_id: hydrated.lineage_id,
        entry_id: entryId,
        title: hydrated.title,
        type: hydrated.type,
        depth: info.depth,
      });
    }
  }

  // Apply limit to nodes (sorted by depth ascending)
  const nodes = Array.from(nodesByLineage.values())
    .sort((a, b) => a.depth - b.depth)
    .slice(0, limit);

  // Build a set of lineage_ids in the final node set for edge filtering
  const nodeLineageSet = new Set(nodes.map((n) => n.lineage_id));
  const rootLineage = rootEntry.lineage_id;

  // Build edges — explicit wins over tag/fts for same (source, target) pair
  // Key: `${source_lineage_id}::${target_lineage_id}`
  const edgeMap = new Map<string, GraphEdge>();

  // 1. Process explicit edges first
  const rootHydrated = hydratedMap.get(rootEntryId);
  for (const row of explicitEdgeRows) {
    const srcHydrated = hydratedMap.get(row.source_entry_id);
    const tgtHydrated = hydratedMap.get(row.target_entry_id);
    if (!srcHydrated || !tgtHydrated) continue;
    // Only include edges where both endpoints are in the graph
    if (
      !nodeLineageSet.has(srcHydrated.lineage_id) &&
      srcHydrated.lineage_id !== rootLineage
    ) continue;
    if (
      !nodeLineageSet.has(tgtHydrated.lineage_id) &&
      tgtHydrated.lineage_id !== rootLineage
    ) continue;

    const key = `${srcHydrated.lineage_id}::${tgtHydrated.lineage_id}`;
    edgeMap.set(key, {
      source_lineage_id: srcHydrated.lineage_id,
      target_lineage_id: tgtHydrated.lineage_id,
      relation_type: row.relation_type,
      signal: "explicit",
      score: 1.0,
    });
  }

  // 2. Tag edges (only if no explicit edge already covers this pair)
  if (signals.includes("tag")) {
    for (const node of nodes) {
      if (!tagScores.has(node.entry_id)) continue;
      const jaccard = tagScores.get(node.entry_id)!;
      const fwdKey = `${rootLineage}::${node.lineage_id}`;
      const revKey = `${node.lineage_id}::${rootLineage}`;
      if (!edgeMap.has(fwdKey) && !edgeMap.has(revKey)) {
        edgeMap.set(fwdKey, {
          source_lineage_id: rootLineage,
          target_lineage_id: node.lineage_id,
          relation_type: "related_to",
          signal: "tag",
          score: jaccard,
        });
      }
    }
  }

  // 3. FTS edges (only if no explicit or tag edge already covers this pair)
  if (signals.includes("fts")) {
    for (const node of nodes) {
      if (!ftsScores.has(node.entry_id)) continue;
      const score = ftsScores.get(node.entry_id)!;
      const fwdKey = `${rootLineage}::${node.lineage_id}`;
      const revKey = `${node.lineage_id}::${rootLineage}`;
      if (!edgeMap.has(fwdKey) && !edgeMap.has(revKey)) {
        edgeMap.set(fwdKey, {
          source_lineage_id: rootLineage,
          target_lineage_id: node.lineage_id,
          relation_type: "related_to",
          signal: "fts",
          score,
        });
      }
    }
  }

  return {
    nodes,
    edges: Array.from(edgeMap.values()),
  };
}

// ─── getBacklinks ─────────────────────────────────────────────────────────────

export function getBacklinks(db: Database.Database, entryId: string): GraphNode[] {
  const incomingLinks = listIncomingLinks(db, entryId);
  if (incomingLinks.length === 0) return [];

  const sourceIds = incomingLinks.map((l) => l.source_entry_id);
  const hydratedMap = hydrateEntries(db, sourceIds);

  const nodesByLineage = new Map<string, GraphNode>();
  for (const link of incomingLinks) {
    const hydrated = hydratedMap.get(link.source_entry_id);
    if (!hydrated) continue;
    if (!nodesByLineage.has(hydrated.lineage_id)) {
      nodesByLineage.set(hydrated.lineage_id, {
        lineage_id: hydrated.lineage_id,
        entry_id: hydrated.id,
        title: hydrated.title,
        type: hydrated.type,
        depth: 1,
      });
    }
  }
  return Array.from(nodesByLineage.values());
}

// ─── suggestRelations ─────────────────────────────────────────────────────────

export function suggestRelations(
  db: Database.Database,
  entryId: string,
  opts?: SuggestOptions
): void {
  const signals = opts?.signals ?? ["tag", "fts"];
  const topK = opts?.topK ?? 10;

  if (signals.includes("tag")) {
    const tagRows = findRelatedByTags(db, entryId, topK);
    for (const row of tagRows) {
      upsertSuggestedLink(db, {
        sourceEntryId: entryId,
        targetEntryId: row.entry_id,
        signal: "tag",
        score: row.jaccard,
        rationale: `shared tags: jaccard=${row.jaccard.toFixed(4)}`,
      });
    }
  }

  if (signals.includes("fts")) {
    const ftsRows = findRelatedByFts(db, entryId, topK);
    for (const row of ftsRows) {
      upsertSuggestedLink(db, {
        sourceEntryId: entryId,
        targetEntryId: row.entry_id,
        signal: "fts",
        score: row.score,
        rationale: `fts score=${row.score.toFixed(4)}`,
      });
    }
  }
}

// ─── promoteSuggestion ────────────────────────────────────────────────────────

export function promoteSuggestion(
  db: Database.Database,
  suggestedLinkId: string,
  relationType: string,
  createdBy: string
): string {
  // Load the suggested link to get entry types for direction validation
  const row = db
    .prepare<
      [string],
      { source_entry_id: string; target_entry_id: string }
    >(`SELECT source_entry_id, target_entry_id FROM suggested_links WHERE id = ?`)
    .get(suggestedLinkId);

  if (!row) {
    throw new Error(`Suggested link not found: ${suggestedLinkId}`);
  }

  // validateDirection requires entry type info — load both entries
  const sourceRow = db
    .prepare<[string], { type: string }>(
      `SELECT type FROM entries WHERE id = ?`
    )
    .get(row.source_entry_id);

  const targetRow = db
    .prepare<[string], { type: string }>(
      `SELECT type FROM entries WHERE id = ?`
    )
    .get(row.target_entry_id);

  if (!sourceRow || !targetRow) {
    throw new Error(
      `Cannot promote suggestion ${suggestedLinkId}: one or both linked entries no longer exist`
    );
  }
  validateDirection(
    relationType,
    sourceRow.type as Parameters<typeof validateDirection>[1],
    targetRow.type as Parameters<typeof validateDirection>[2]
  );

  return promoteSuggestedLink(db, suggestedLinkId, relationType, createdBy);
}
