import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ulid } from "ulid";

import { createMcpServer } from "../../src/mcp/server.js";
import { registerEntryTools } from "../../src/mcp/tools/entry-tools.js";
import { archiveEntry, createEntry, updateEntry } from "../../src/service/entries.js";
import { DomainError } from "../../src/service/errors.js";
import { createMigratedTestDb, type TestDbContext } from "../helpers/test-db.js";

describe("integration: lineage diagnostics on update_entry", () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createMigratedTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("throws actionable error when caller passes entry_id instead of lineage_id", async () => {
    const created = createEntry(ctx.db, {
      type: "note",
      title: "Test Note",
      body_markdown: "Content here.",
      created_by: "test"
    });

    // Pass entry_id where lineage_id is required
    let caught: unknown;
    try {
      updateEntry(ctx.db, {
        lineage_id: created.entry_id,
        expected_version: 1,
        body_markdown: "Updated.",
        created_by: "test"
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(DomainError);
    const err = caught as DomainError;
    expect(err.code).toBe("ENTRY_NOT_FOUND");
    expect(err.message).toContain("entry_id");
    expect(err.message).toContain(created.lineage_id);
    expect(err.suggestion).toContain("lineage_id");
  });

  it("throws generic not-found error for a completely unknown ULID", () => {
    const unknownUlid = ulid();

    expect(() =>
      updateEntry(ctx.db, {
        lineage_id: unknownUlid,
        expected_version: 1,
        body_markdown: "Updated.",
        created_by: "test"
      })
    ).toThrowError(/Lineage not found/);
  });

  it("throws 'Archived entries cannot be edited' for archived lineage (regression)", () => {
    const created = createEntry(ctx.db, {
      type: "note",
      title: "To Archive",
      body_markdown: "Will be archived.",
      created_by: "test"
    });

    archiveEntry(ctx.db, created.lineage_id);

    expect(() =>
      updateEntry(ctx.db, {
        lineage_id: created.lineage_id,
        expected_version: 1,
        body_markdown: "Try updating archived.",
        created_by: "test"
      })
    ).toThrowError(/Archived entries cannot be edited/);
  });

  it("throws orphan diagnostic when lineage exists but no is_latest=1 row", () => {
    const created = createEntry(ctx.db, {
      type: "note",
      title: "Orphan Lineage",
      body_markdown: "Will lose its head.",
      created_by: "test"
    });

    // Simulate corrupt state: no head row
    ctx.db
      .prepare("UPDATE entries SET is_latest = 0 WHERE lineage_id = ?")
      .run(created.lineage_id);

    let caught: unknown;
    try {
      updateEntry(ctx.db, {
        lineage_id: created.lineage_id,
        expected_version: 1,
        body_markdown: "Updated.",
        created_by: "test"
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(DomainError);
    const err = caught as DomainError;
    expect(err.code).toBe("ENTRY_NOT_FOUND");
    expect(err.message).toContain("no head row");
    expect(err.suggestion).toContain("Inspect");
  });

  it("rejects non-ULID lineage_id at MCP schema layer", async () => {
    const mcp = createMcpServer();
    registerEntryTools(mcp, ctx.db);

    const result = await mcp.callTool("libraxis_update_entry", {
      lineage_id: "not-a-ulid",
      expected_version: 1,
      body_markdown: "Updated.",
      created_by: "test"
    });
    expect((result as { error: string }).error).toMatch(/Crockford ULID/);
  });
});
