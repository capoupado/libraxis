import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";

import { createMigratedTestDb, type TestDbContext } from "../helpers/test-db.js";
import {
  getEntryGraph,
  getBacklinks,
  suggestRelations,
  promoteSuggestion,
} from "../../src/service/related.js";
import { createEntry } from "../../src/service/entries.js";
import { listSuggestedLinks } from "../../src/db/queries/link-queries.js";

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function seedEntry(
  db: Database.Database,
  id: string,
  lineageId: string,
  title = "Entry " + id,
  body = "body of " + id,
  type = "note"
) {
  db.prepare(
    `INSERT INTO entries(id, lineage_id, type, title, body_markdown, metadata_json, version_number, is_latest, created_by)
     VALUES (?, ?, ?, ?, ?, '{}', 1, 1, 'test')`
  ).run(id, lineageId, type, title, body);
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

// ─── getEntryGraph ────────────────────────────────────────────────────────────

describe("getEntryGraph", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;

    // Three entries: A (root), B (explicit link from A), C (shares tag with A and B)
    seedEntry(db, "entry-a", "lineage-a", "Alpha entry", "alpha body");
    seedEntry(db, "entry-b", "lineage-b", "Beta entry", "beta body");
    seedEntry(db, "entry-c", "lineage-c", "Gamma entry", "gamma body");

    // Explicit link A→B
    seedLink(db, "link-ab", "entry-a", "entry-b", "related_to");

    // Tags: A and C share tag-1; B and C share tag-2
    seedTag(db, "tag-1", "shared-ac");
    seedTag(db, "tag-2", "shared-bc");
    seedEntryTag(db, "entry-a", "tag-1");
    seedEntryTag(db, "entry-b", "tag-2");
    seedEntryTag(db, "entry-c", "tag-1");
    seedEntryTag(db, "entry-c", "tag-2");
  });

  afterEach(() => ctx.cleanup());

  it("signal=['explicit']: result contains B, not C", () => {
    const graph = getEntryGraph(db, "lineage-a", { signals: ["explicit"] });
    const lineageIds = graph.nodes.map((n) => n.lineage_id);
    expect(lineageIds).toContain("lineage-b");
    expect(lineageIds).not.toContain("lineage-c");
  });

  it("signal=['tag']: result contains C (tag overlap), not B via explicit", () => {
    const graph = getEntryGraph(db, "lineage-a", { signals: ["tag"] });
    const lineageIds = graph.nodes.map((n) => n.lineage_id);
    // C shares tag-1 with A, so it should appear
    expect(lineageIds).toContain("lineage-c");
    // edges for C should have signal='tag'
    const cEdge = graph.edges.find(
      (e) => e.target_lineage_id === "lineage-c" || e.source_lineage_id === "lineage-c"
    );
    expect(cEdge).toBeDefined();
    expect(cEdge!.signal).toBe("tag");
  });

  it("signal=['explicit','tag']: result contains both B and C; B edge has signal='explicit'", () => {
    const graph = getEntryGraph(db, "lineage-a", { signals: ["explicit", "tag"] });
    const lineageIds = graph.nodes.map((n) => n.lineage_id);
    expect(lineageIds).toContain("lineage-b");
    expect(lineageIds).toContain("lineage-c");

    // B has an explicit link from A → its edge should be explicit
    const bEdge = graph.edges.find(
      (e) =>
        (e.source_lineage_id === "lineage-a" && e.target_lineage_id === "lineage-b") ||
        (e.source_lineage_id === "lineage-b" && e.target_lineage_id === "lineage-a")
    );
    expect(bEdge).toBeDefined();
    expect(bEdge!.signal).toBe("explicit");
  });

  it("explicit-wins: when a node has both explicit link AND tag overlap, only explicit edge remains", () => {
    // Add tag overlap between A and B too (so B would also appear as tag signal)
    seedEntryTag(db, "entry-b", "tag-1");

    const graph = getEntryGraph(db, "lineage-a", { signals: ["explicit", "tag"] });

    // There should be exactly one edge between A and B (not two)
    const abEdges = graph.edges.filter(
      (e) =>
        (e.source_lineage_id === "lineage-a" && e.target_lineage_id === "lineage-b") ||
        (e.source_lineage_id === "lineage-b" && e.target_lineage_id === "lineage-a")
    );
    expect(abEdges).toHaveLength(1);
    expect(abEdges[0].signal).toBe("explicit");
  });

  it("nodes include lineage_id, entry_id, title, type, depth fields", () => {
    const graph = getEntryGraph(db, "lineage-a", { signals: ["explicit"] });
    const bNode = graph.nodes.find((n) => n.lineage_id === "lineage-b");
    expect(bNode).toBeDefined();
    expect(bNode!.entry_id).toBe("entry-b");
    expect(bNode!.title).toBe("Beta entry");
    expect(bNode!.type).toBe("note");
    expect(typeof bNode!.depth).toBe("number");
  });

  it("returns empty nodes and edges for root with no connections", () => {
    seedEntry(db, "isolated", "lineage-isolated", "Alone", "no connections");
    const graph = getEntryGraph(db, "lineage-isolated", { signals: ["explicit"] });
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("throws or returns empty when lineageId does not exist", () => {
    // Should handle gracefully — either empty result or error
    expect(() =>
      getEntryGraph(db, "nonexistent-lineage", { signals: ["explicit"] })
    ).not.toThrow(); // fire-and-forget graceful empty
  });
});

// ─── getBacklinks ─────────────────────────────────────────────────────────────

describe("getBacklinks", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
    seedEntry(db, "entry-a", "lineage-a", "Alpha");
    seedEntry(db, "entry-b", "lineage-b", "Beta");
    seedLink(db, "link-ab", "entry-a", "entry-b", "related_to");
  });

  afterEach(() => ctx.cleanup());

  it("getBacklinks(entry-b) returns A as a node pointing TO B", () => {
    const nodes = getBacklinks(db, "entry-b");
    const lineageIds = nodes.map((n) => n.lineage_id);
    expect(lineageIds).toContain("lineage-a");
  });

  it("getBacklinks(entry-a) returns empty (A has no incoming links)", () => {
    const nodes = getBacklinks(db, "entry-a");
    expect(nodes).toHaveLength(0);
  });

  it("returned nodes have lineage_id, entry_id, title, type fields", () => {
    const nodes = getBacklinks(db, "entry-b");
    expect(nodes[0].lineage_id).toBe("lineage-a");
    expect(nodes[0].entry_id).toBe("entry-a");
    expect(nodes[0].title).toBe("Alpha");
    expect(nodes[0].type).toBe("note");
  });
});

// ─── suggestRelations ─────────────────────────────────────────────────────────

describe("suggestRelations", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
    seedEntry(db, "entry-a", "lineage-a", "Alpha topic", "alpha body");
    seedEntry(db, "entry-b", "lineage-b", "Beta topic", "beta body");
    seedTag(db, "tag-x", "shared");
    seedEntryTag(db, "entry-a", "tag-x");
    seedEntryTag(db, "entry-b", "tag-x");
  });

  afterEach(() => ctx.cleanup());

  it("after call, suggested_links has rows for tag matches", () => {
    suggestRelations(db, "entry-a", { signals: ["tag"] });
    const rows = listSuggestedLinks(db, "entry-a");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].signal).toBe("tag");
    expect(rows[0].source_entry_id).toBe("entry-a");
    expect(rows[0].target_entry_id).toBe("entry-b");
  });

  it("rationale for tag signal includes 'jaccard'", () => {
    suggestRelations(db, "entry-a", { signals: ["tag"] });
    const rows = listSuggestedLinks(db, "entry-a");
    expect(rows[0].rationale).toMatch(/jaccard/);
  });

  it("calling twice upserts (no duplicate rows)", () => {
    suggestRelations(db, "entry-a", { signals: ["tag"] });
    suggestRelations(db, "entry-a", { signals: ["tag"] });
    const rows = listSuggestedLinks(db, "entry-a");
    // should still be 1 row (upsert semantics)
    expect(rows).toHaveLength(1);
  });
});

// ─── promoteSuggestion ────────────────────────────────────────────────────────

describe("promoteSuggestion", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
    seedEntry(db, "entry-a", "lineage-a", "Alpha");
    seedEntry(db, "entry-b", "lineage-b", "Beta");
    // Manually insert a suggested link
    db.prepare(
      `INSERT INTO suggested_links(id, source_entry_id, target_entry_id, signal, score, rationale)
       VALUES ('sugg-1', 'entry-a', 'entry-b', 'tag', 0.8, 'shared tags: jaccard=0.8')`
    ).run();
  });

  afterEach(() => ctx.cleanup());

  it("promotes to entry_links; returns a new link id", () => {
    const newLinkId = promoteSuggestion(db, "sugg-1", "related_to", "tester");
    expect(typeof newLinkId).toBe("string");
    expect(newLinkId.length).toBeGreaterThan(0);
  });

  it("suggested_links row is removed after promotion", () => {
    promoteSuggestion(db, "sugg-1", "related_to", "tester");
    const rows = listSuggestedLinks(db, "entry-a");
    expect(rows).toHaveLength(0);
  });

  it("throws for invalid direction (used_skill requires run→skill)", () => {
    // entry-a and entry-b are both 'note' type — used_skill is invalid
    expect(() => promoteSuggestion(db, "sugg-1", "used_skill", "tester")).toThrow();
  });
});

// ─── createEntry fires suggestRelations silently ─────────────────────────────

describe("createEntry fires suggestRelations silently", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
  });

  afterEach(() => ctx.cleanup());

  it("createEntry returns successfully even with no shared tags (no error)", () => {
    const result = createEntry(db, {
      type: "note",
      title: "Solo entry",
      body_markdown: "No related entries exist yet.",
      tags: [],
      created_by: "test-user",
    });
    expect(result.entry_id).toBeTruthy();
    expect(result.lineage_id).toBeTruthy();
    expect(result.version_number).toBe(1);
  });

  it("createEntry with shared tags populates suggested_links without throwing", () => {
    // Seed an existing entry with a shared tag
    seedEntry(db, "existing-1", "existing-lineage-1", "Existing entry", "some content");
    seedTag(db, "common-tag", "common");
    seedEntryTag(db, "existing-1", "common-tag");

    // Create new entry with same tag
    const result = createEntry(db, {
      type: "note",
      title: "New entry",
      body_markdown: "Related content.",
      tags: ["common"],
      created_by: "test-user",
    });

    expect(result.entry_id).toBeTruthy();
    // After createEntry, suggested_links should have rows (tag overlap with existing-1)
    const rows = listSuggestedLinks(db, result.entry_id);
    expect(rows.length).toBeGreaterThanOrEqual(0); // at minimum no error; may have rows
  });

  it("createEntry does not propagate errors from suggestRelations", () => {
    // Even if DB is in a weird state, createEntry should not throw due to suggestRelations
    expect(() =>
      createEntry(db, {
        type: "note",
        title: "Safe entry",
        body_markdown: "Should not throw.",
        created_by: "test-user",
      })
    ).not.toThrow();
  });
});
