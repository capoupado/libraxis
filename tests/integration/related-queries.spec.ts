import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";

import { createMigratedTestDb, type TestDbContext } from "../helpers/test-db.js";
import {
  listOutgoingLinks,
  listIncomingLinks,
  traverseNeighborhood,
  upsertSuggestedLink,
  listSuggestedLinks,
  deleteSuggestedLink,
  promoteSuggestedLink,
} from "../../src/db/queries/link-queries.js";
import {
  findRelatedByTags,
  findRelatedByFts,
} from "../../src/db/queries/related-queries.js";

// ─── Seed helpers ────────────────────────────────────────────────────────────

function seedEntry(
  db: Database.Database,
  id: string,
  title = "Entry " + id,
  body = "body of " + id
) {
  db.prepare(
    `INSERT INTO entries(id, lineage_id, type, title, body_markdown, metadata_json, version_number, is_latest, created_by)
     VALUES (?, ?, 'note', ?, ?, '{}', 1, 1, 'test')`
  ).run(id, id, title, body);
}

function seedTag(db: Database.Database, tagId: string, name: string) {
  db.prepare("INSERT INTO tags(id, name) VALUES (?, ?)").run(tagId, name);
}

function seedEntryTag(db: Database.Database, entryId: string, tagId: string) {
  db.prepare("INSERT INTO entry_tags(entry_id, tag_id) VALUES (?, ?)").run(entryId, tagId);
}

function seedLink(
  db: Database.Database,
  id: string,
  src: string,
  tgt: string,
  rel = "related_to"
) {
  db.prepare(
    "INSERT INTO entry_links(id, source_entry_id, target_entry_id, relation_type, created_by) VALUES (?, ?, ?, ?, 'test')"
  ).run(id, src, tgt, rel);
}

// ─── traverseNeighborhood ────────────────────────────────────────────────────

describe("traverseNeighborhood", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
    // Diamond: A→B, A→C, B→D, C→D, plus back-edge D→A for cycle test
    for (const id of ["A", "B", "C", "D"]) seedEntry(db, id);
    seedLink(db, "ab", "A", "B");
    seedLink(db, "ac", "A", "C");
    seedLink(db, "bd", "B", "D");
    seedLink(db, "cd", "C", "D");
    seedLink(db, "da", "D", "A"); // back-edge / potential cycle
  });

  afterEach(() => ctx.cleanup());

  it("depth=1 from A gives B and C (not D)", () => {
    const result = traverseNeighborhood(db, "A", { depth: 1, direction: "out" });
    const ids = result.nodes.map((n) => n.node_id).sort();
    // Should include A (root at depth 0) and B, C at depth 1
    expect(ids).toContain("B");
    expect(ids).toContain("C");
    expect(ids).not.toContain("D");
  });

  it("depth=2 from A gives B, C, and D", () => {
    const result = traverseNeighborhood(db, "A", { depth: 2, direction: "out" });
    const ids = result.nodes.map((n) => n.node_id);
    expect(ids).toContain("B");
    expect(ids).toContain("C");
    expect(ids).toContain("D");
  });

  it("cycle guard — depth=3 from A with both direction does not duplicate A or loop infinitely", () => {
    const result = traverseNeighborhood(db, "A", { depth: 3, direction: "both" });
    const ids = result.nodes.map((n) => n.node_id);
    // A should appear exactly once (or not at all among non-root nodes)
    const countA = ids.filter((id) => id === "A").length;
    expect(countA).toBeLessThanOrEqual(1);
    // Should terminate without hanging
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it("direction='out' from A does not include nodes that only point in to A", () => {
    // D has an edge D→A, but going 'out' from A should never reach D via that back-edge
    const result = traverseNeighborhood(db, "A", { depth: 1, direction: "out" });
    const ids = result.nodes.map((n) => n.node_id);
    // At depth=1 'out', we only follow A→B and A→C
    expect(ids).not.toContain("D");
  });

  it("relationTypes filter restricts traversal to matching edges", () => {
    // Add a differently-typed link A→B overridden: use a 'special' type edge from A to D directly
    seedEntry(db, "E");
    seedLink(db, "ae", "A", "E", "special");
    // With filter ['related_to'] we should get B and C but not E
    const result = traverseNeighborhood(db, "A", {
      depth: 1,
      direction: "out",
      relationTypes: ["related_to"],
    });
    const ids = result.nodes.map((n) => n.node_id);
    expect(ids).toContain("B");
    expect(ids).toContain("C");
    expect(ids).not.toContain("E");
  });

  it("edges in result contain the links between discovered nodes", () => {
    const result = traverseNeighborhood(db, "A", { depth: 2, direction: "out" });
    // Edges should include the ab and ac links at minimum
    const edgeSources = result.edges.map((e) => e.source_entry_id);
    expect(edgeSources).toContain("A");
  });
});

// ─── listOutgoingLinks / listIncomingLinks ───────────────────────────────────

describe("listOutgoingLinks / listIncomingLinks", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
    seedEntry(db, "X");
    seedEntry(db, "Y");
    seedLink(db, "xy", "X", "Y");
  });

  afterEach(() => ctx.cleanup());

  it("listOutgoingLinks(X) returns 1 row pointing to Y", () => {
    const rows = listOutgoingLinks(db, "X");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.target_entry_id).toBe("Y");
    expect(rows[0]!.source_entry_id).toBe("X");
  });

  it("listIncomingLinks(Y) returns 1 row coming from X", () => {
    const rows = listIncomingLinks(db, "Y");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source_entry_id).toBe("X");
    expect(rows[0]!.target_entry_id).toBe("Y");
  });

  it("listIncomingLinks(X) is empty (X has no incoming links)", () => {
    const rows = listIncomingLinks(db, "X");
    expect(rows).toHaveLength(0);
  });

  it("listOutgoingLinks(Y) is empty (Y has no outgoing links)", () => {
    const rows = listOutgoingLinks(db, "Y");
    expect(rows).toHaveLength(0);
  });
});

// ─── upsertSuggestedLink / listSuggestedLinks / promoteSuggestedLink ─────────

describe("upsertSuggestedLink / listSuggestedLinks / deleteSuggestedLink / promoteSuggestedLink", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
    seedEntry(db, "P");
    seedEntry(db, "Q");
  });

  afterEach(() => ctx.cleanup());

  it("upsert same (source,target,signal) twice → only 1 row, score updated", () => {
    upsertSuggestedLink(db, {
      sourceEntryId: "P",
      targetEntryId: "Q",
      signal: "tag",
      score: 0.5,
    });
    upsertSuggestedLink(db, {
      sourceEntryId: "P",
      targetEntryId: "Q",
      signal: "tag",
      score: 0.9,
      rationale: "updated",
    });
    const rows = listSuggestedLinks(db, "P");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBeCloseTo(0.9);
    expect(rows[0]!.rationale).toBe("updated");
  });

  it("listSuggestedLinks without filter returns all rows", () => {
    seedEntry(db, "R");
    upsertSuggestedLink(db, { sourceEntryId: "P", targetEntryId: "Q", signal: "fts", score: 0.3 });
    upsertSuggestedLink(db, { sourceEntryId: "Q", targetEntryId: "R", signal: "tag", score: 0.7 });
    const all = listSuggestedLinks(db);
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("deleteSuggestedLink removes the row", () => {
    upsertSuggestedLink(db, { sourceEntryId: "P", targetEntryId: "Q", signal: "tag", score: 0.4 });
    const rows = listSuggestedLinks(db, "P");
    expect(rows).toHaveLength(1);
    deleteSuggestedLink(db, rows[0]!.id);
    expect(listSuggestedLinks(db, "P")).toHaveLength(0);
  });

  it("promote: entry_links gains 1 row, suggested_links loses 1 row (transaction)", () => {
    upsertSuggestedLink(db, {
      sourceEntryId: "P",
      targetEntryId: "Q",
      signal: "tag",
      score: 0.8,
    });
    const suggested = listSuggestedLinks(db, "P");
    expect(suggested).toHaveLength(1);

    const newLinkId = promoteSuggestedLink(db, suggested[0]!.id, "related_to", "tester");

    expect(typeof newLinkId).toBe("string");
    expect(newLinkId.length).toBeGreaterThan(0);

    // suggested_links row gone
    expect(listSuggestedLinks(db, "P")).toHaveLength(0);

    // entry_links gained a row
    const links = listOutgoingLinks(db, "P");
    expect(links).toHaveLength(1);
    expect(links[0]!.id).toBe(newLinkId);
    expect(links[0]!.relation_type).toBe("related_to");
  });
});

// ─── findRelatedByTags ───────────────────────────────────────────────────────

describe("findRelatedByTags", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
    // Entry M has tags t1, t2; Entry N has tags t1, t2, t3; Entry O has tag t3 only
    for (const id of ["M", "N", "O"]) seedEntry(db, id);
    seedTag(db, "t1", "alpha");
    seedTag(db, "t2", "beta");
    seedTag(db, "t3", "gamma");
    seedEntryTag(db, "M", "t1");
    seedEntryTag(db, "M", "t2");
    seedEntryTag(db, "N", "t1");
    seedEntryTag(db, "N", "t2");
    seedEntryTag(db, "N", "t3");
    seedEntryTag(db, "O", "t3");
  });

  afterEach(() => ctx.cleanup());

  it("returns entries with shared tags sorted by jaccard desc", () => {
    const rows = findRelatedByTags(db, "M", 10);
    const ids = rows.map((r) => r.entry_id);
    // N shares 2/3 tags with M; O shares 0 tags → only N returned
    expect(ids).toContain("N");
    expect(ids).not.toContain("O");
    expect(ids).not.toContain("M");
    expect(rows[0]!.jaccard).toBeGreaterThan(0);
  });

  it("returns empty array when entry has no shared tags", () => {
    seedEntry(db, "Z");
    const rows = findRelatedByTags(db, "Z", 10);
    expect(rows).toHaveLength(0);
  });

  it("respects limit", () => {
    const rows = findRelatedByTags(db, "M", 1);
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});

// ─── findRelatedByFts ────────────────────────────────────────────────────────

describe("findRelatedByFts", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
    // Entries about "machine learning" and one unrelated
    seedEntry(db, "fts1", "Machine learning basics", "Introduction to machine learning concepts");
    seedEntry(db, "fts2", "Deep learning guide", "A guide to machine learning and deep learning");
    seedEntry(db, "fts3", "Cooking recipes", "How to cook pasta and risotto");
  });

  afterEach(() => ctx.cleanup());

  it("returns entries matching the FTS title, excluding the source entry", () => {
    const rows = findRelatedByFts(db, "fts1", 10);
    const ids = rows.map((r) => r.entry_id);
    expect(ids).not.toContain("fts1");
    // fts2 mentions "machine learning" so should match
    expect(ids).toContain("fts2");
  });

  it("returns empty array for entry with empty/punctuation-only title", () => {
    seedEntry(db, "fts4", "!!! ???", "some body");
    const rows = findRelatedByFts(db, "fts4", 10);
    expect(rows).toHaveLength(0);
  });

  it("scores are numeric (bm25 returns negative values)", () => {
    const rows = findRelatedByFts(db, "fts1", 10);
    for (const row of rows) {
      expect(typeof row.score).toBe("number");
    }
  });
});
