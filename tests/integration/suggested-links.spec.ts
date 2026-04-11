import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";

import { createMigratedTestDb, type TestDbContext } from "../helpers/test-db.js";
import {
  upsertSuggestedLink,
  listSuggestedLinks,
  promoteSuggestedLink,
  listOutgoingLinks,
} from "../../src/db/queries/link-queries.js";
import {
  promoteSuggestion,
} from "../../src/service/related.js";

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function seedEntry(
  db: Database.Database,
  id: string,
  type = "note",
  title = "Entry " + id
) {
  db.prepare(
    `INSERT INTO entries(id, lineage_id, type, title, body_markdown, metadata_json, version_number, is_latest, created_by)
     VALUES (?, ?, ?, ?, 'body', '{}', 1, 1, 'test')`
  ).run(id, id, type, title);
}

// ─── Upsert idempotency ───────────────────────────────────────────────────────

describe("upsertSuggestedLink — idempotency", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
    seedEntry(db, "src");
    seedEntry(db, "tgt");
  });

  afterEach(() => ctx.cleanup());

  it("upserting same (source, target, signal) twice yields exactly 1 row with the latest score", () => {
    upsertSuggestedLink(db, {
      sourceEntryId: "src",
      targetEntryId: "tgt",
      signal: "tag",
      score: 0.5,
    });
    upsertSuggestedLink(db, {
      sourceEntryId: "src",
      targetEntryId: "tgt",
      signal: "tag",
      score: 0.9,
      rationale: "updated rationale",
    });

    const rows = listSuggestedLinks(db, "src");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBeCloseTo(0.9);
    expect(rows[0]!.rationale).toBe("updated rationale");
  });

  it("different signals for same (source, target) pair produce separate rows", () => {
    upsertSuggestedLink(db, {
      sourceEntryId: "src",
      targetEntryId: "tgt",
      signal: "tag",
      score: 0.5,
    });
    upsertSuggestedLink(db, {
      sourceEntryId: "src",
      targetEntryId: "tgt",
      signal: "fts",
      score: 0.6,
    });

    const rows = listSuggestedLinks(db, "src");
    expect(rows).toHaveLength(2);
  });
});

// ─── Promote transaction ──────────────────────────────────────────────────────

describe("promoteSuggestedLink — transaction", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
    seedEntry(db, "src");
    seedEntry(db, "tgt");
  });

  afterEach(() => ctx.cleanup());

  it("after promote: entry_links gains 1 row and suggested_links has 0 rows for that pair", () => {
    upsertSuggestedLink(db, {
      sourceEntryId: "src",
      targetEntryId: "tgt",
      signal: "tag",
      score: 0.8,
    });

    const suggested = listSuggestedLinks(db, "src");
    expect(suggested).toHaveLength(1);

    const newLinkId = promoteSuggestedLink(db, suggested[0]!.id, "related_to", "tester");

    // entry_links gained a row
    const links = listOutgoingLinks(db, "src");
    expect(links).toHaveLength(1);
    expect(links[0]!.id).toBe(newLinkId);
    expect(links[0]!.relation_type).toBe("related_to");

    // suggested_links lost the row
    expect(listSuggestedLinks(db, "src")).toHaveLength(0);
  });

  it("promoteSuggestedLink returns a non-empty string id", () => {
    upsertSuggestedLink(db, {
      sourceEntryId: "src",
      targetEntryId: "tgt",
      signal: "fts",
      score: 0.7,
    });

    const rows = listSuggestedLinks(db, "src");
    const newId = promoteSuggestedLink(db, rows[0]!.id, "related_to", "tester");

    expect(typeof newId).toBe("string");
    expect(newId.length).toBeGreaterThan(0);
  });
});

// ─── validateDirection on promote ────────────────────────────────────────────

describe("promoteSuggestion — validateDirection", () => {
  let ctx: TestDbContext;
  let db: Database.Database;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
    // Both entries are 'note' type — used_skill is only valid for run→skill
    seedEntry(db, "note-a", "note", "Note A");
    seedEntry(db, "note-b", "note", "Note B");

    db.prepare(
      `INSERT INTO suggested_links(id, source_entry_id, target_entry_id, signal, score, rationale)
       VALUES ('sugg-dir-1', 'note-a', 'note-b', 'tag', 0.8, 'shared tags')`
    ).run();
  });

  afterEach(() => ctx.cleanup());

  it("promoteSuggestion throws when relation_type='used_skill' on note→note entries", () => {
    expect(() => promoteSuggestion(db, "sugg-dir-1", "used_skill", "tester")).toThrow();
  });

  it("suggested_link row still exists after failed promotion", () => {
    try {
      promoteSuggestion(db, "sugg-dir-1", "used_skill", "tester");
    } catch {
      // expected
    }

    // Row must still be present (transaction rolled back)
    const rows = listSuggestedLinks(db, "note-a");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("sugg-dir-1");
  });

  it("promoteSuggestion succeeds with valid relation_type for note→note", () => {
    const newId = promoteSuggestion(db, "sugg-dir-1", "related_to", "tester");
    expect(typeof newId).toBe("string");
    expect(newId.length).toBeGreaterThan(0);
  });
});
