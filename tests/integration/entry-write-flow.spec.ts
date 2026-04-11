import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../../src/mcp/server.js";
import { registerEntryTools } from "../../src/mcp/tools/entry-tools.js";
import {
  archiveEntry,
  getEntryHistory,
  restoreEntry,
  searchEntries
} from "../../src/service/entries.js";
import { traverseLinks } from "../../src/service/links.js";
import { createMigratedTestDb, type TestDbContext } from "../helpers/test-db.js";

describe("integration: entry write flow", () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createMigratedTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("supports note -> note -> mistake+lesson -> link workflow with append-only history", async () => {
    const mcp = createMcpServer();
    registerEntryTools(mcp, ctx.db);

    const prompt = (await mcp.callTool("libraxis_create_entry", {
      type: "note",
      title: "Initial Note",
      body_markdown: "Analyze task and produce remediation plan.",
      created_by: "integration"
    })) as { entry_id: string; lineage_id: string; version_number: number };

    expect(prompt.version_number).toBe(1);

    await expect(
      mcp.callTool("libraxis_log_run", {
        outcome: "success",
        duration_ms: 900,
        notes: "Completed with expected result.",
        prompt_entry_id: prompt.entry_id,
        created_by: "integration"
      })
    ).rejects.toThrow("Tool not registered: libraxis_log_run");

    const note = (await mcp.callTool("libraxis_create_entry", {
      type: "note",
      title: "Execution Note",
      body_markdown: "Completed with expected result.",
      created_by: "integration"
    })) as { entry_id: string; lineage_id: string; version_number: number };

    expect(note.entry_id).toBeDefined();

    const mistakeLesson = (await mcp.callTool("libraxis_log_mistake_with_lesson", {
      mistake_title: "Forgot dry-run",
      mistake_body: "Applied mutation before validation.",
      lesson_title: "Always dry-run",
      lesson_body: "Run no-op validation before write actions.",
      created_by: "integration"
    })) as {
      mistake_entry_id: string;
      lesson_entry_id: string;
      link_id: string;
    };

    expect(mistakeLesson.link_id).toBeDefined();

    const linkResult = (await mcp.callTool("libraxis_link_entries", {
      source_entry_id: note.entry_id,
      target_entry_id: prompt.entry_id,
      relation_type: "related_to",
      created_by: "integration"
    })) as { link_id: string };

    expect(linkResult.link_id).toBeDefined();

    const updatedPrompt = (await mcp.callTool("libraxis_update_entry", {
      lineage_id: prompt.lineage_id,
      expected_version: 1,
      body_markdown: "Analyze task, validate assumptions, then produce remediation.",
      created_by: "integration"
    })) as { lineage_id: string; version_number: number };

    expect(updatedPrompt.version_number).toBe(2);

    const history = getEntryHistory(ctx.db, prompt.lineage_id);
    expect(history.length).toBe(2);
    expect(history[0]?.version_number).toBe(2);
    expect(history[1]?.version_number).toBe(1);

    const beforeArchive = searchEntries(ctx.db, "initial", 20);
    expect(beforeArchive.some((entry) => entry.lineage_id === prompt.lineage_id)).toBe(true);

    const archived = archiveEntry(ctx.db, prompt.lineage_id);
    expect(archived.status).toBe("archived");

    const whileArchived = searchEntries(ctx.db, "initial", 20);
    expect(whileArchived.some((entry) => entry.lineage_id === prompt.lineage_id)).toBe(false);

    const restored = restoreEntry(ctx.db, prompt.lineage_id);
    expect(restored.status).toBe("active");

    const afterRestore = searchEntries(ctx.db, "initial", 20);
    expect(afterRestore.some((entry) => entry.lineage_id === prompt.lineage_id)).toBe(true);

    const links = traverseLinks(ctx.db, note.entry_id);
    expect(links.length).toBeGreaterThanOrEqual(1);
  });
});
