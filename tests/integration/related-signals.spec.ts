import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";

import { createMigratedTestDb, type TestDbContext } from "../helpers/test-db.js";
import {
  findRelatedByTags,
  findRelatedByFts,
} from "../../src/db/queries/related-queries.js";

// ─── Seed helpers ─────────────────────────────────────────────────────────────

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

// ─── Tag Jaccard ordering ─────────────────────────────────────────────────────

describe("findRelatedByTags — Jaccard ordering", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;

    // Entry A: tags [t1, t2, t3]
    // Entry B: tags [t1, t2]         → intersection=2, union=3 → jaccard ≈ 0.667
    // Entry C: tags [t1]             → intersection=1, union=3 → jaccard ≈ 0.333
    // Entry D: tags [t1, t2, t3, t4] → intersection=3, union=4 → jaccard = 0.75
    for (const id of ["A", "B", "C", "D"]) seedEntry(db, id);
    for (const [id, name] of [["t1","alpha"],["t2","beta"],["t3","gamma"],["t4","delta"]]) {
      seedTag(db, id, name);
    }

    // Entry A's tags
    seedEntryTag(db, "A", "t1");
    seedEntryTag(db, "A", "t2");
    seedEntryTag(db, "A", "t3");

    // Entry B: t1, t2
    seedEntryTag(db, "B", "t1");
    seedEntryTag(db, "B", "t2");

    // Entry C: t1
    seedEntryTag(db, "C", "t1");

    // Entry D: t1, t2, t3, t4
    seedEntryTag(db, "D", "t1");
    seedEntryTag(db, "D", "t2");
    seedEntryTag(db, "D", "t3");
    seedEntryTag(db, "D", "t4");
  });

  afterEach(() => ctx.cleanup());

  it("order is D (0.75) > B (0.667) > C (0.333)", () => {
    const rows = findRelatedByTags(db, "A", 10);
    const ids = rows.map((r) => r.entry_id);

    // All three should appear
    expect(ids).toContain("D");
    expect(ids).toContain("B");
    expect(ids).toContain("C");

    // Self excluded
    expect(ids).not.toContain("A");

    // Strict ordering: D first, then B, then C
    const idxD = ids.indexOf("D");
    const idxB = ids.indexOf("B");
    const idxC = ids.indexOf("C");
    expect(idxD).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
  });

  it("jaccard scores are approximately correct", () => {
    const rows = findRelatedByTags(db, "A", 10);
    const byId = Object.fromEntries(rows.map((r) => [r.entry_id, r.jaccard]));

    expect(byId["D"]).toBeCloseTo(0.75, 2);
    expect(byId["B"]).toBeCloseTo(0.667, 2);
    expect(byId["C"]).toBeCloseTo(0.333, 2);
  });
});

// ─── FTS excludes self ────────────────────────────────────────────────────────

describe("findRelatedByFts — excludes self", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
    seedEntry(db, "fts-main", "typescript testing framework", "testing with typescript");
    seedEntry(db, "fts-other1", "typescript unit tests", "unit testing in typescript");
    seedEntry(db, "fts-other2", "typescript integration", "integration with typescript");
  });

  afterEach(() => ctx.cleanup());

  it("source entry id is never in the results", () => {
    const rows = findRelatedByFts(db, "fts-main", 10);
    const ids = rows.map((r) => r.entry_id);
    expect(ids).not.toContain("fts-main");
  });

  it("other entries with matching terms appear in results", () => {
    const rows = findRelatedByFts(db, "fts-main", 10);
    const ids = rows.map((r) => r.entry_id);
    // At least one of the other typescript entries should match
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).not.toBe("fts-main");
    }
  });
});

// ─── bm25 ordering ───────────────────────────────────────────────────────────

describe("findRelatedByFts — bm25 ordering", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
    // Query entry: "typescript testing"
    // Exact-title match should score higher than partial match
    seedEntry(db, "query-entry", "typescript testing", "some body content");
    seedEntry(db, "exact-match", "typescript testing", "a guide to typescript testing");
    seedEntry(db, "partial-match", "typescript", "only the language name");
  });

  afterEach(() => ctx.cleanup());

  it("results are ordered by score descending (higher score first)", () => {
    const rows = findRelatedByFts(db, "query-entry", 10);
    // Scores should be non-decreasing (already desc sorted by the query)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].score).toBeGreaterThanOrEqual(rows[i].score);
    }
  });

  it("scores are positive numbers (bm25 negated to positive)", () => {
    const rows = findRelatedByFts(db, "query-entry", 10);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.score).toBe("number");
      expect(row.score).toBeGreaterThan(0);
    }
  });
});
