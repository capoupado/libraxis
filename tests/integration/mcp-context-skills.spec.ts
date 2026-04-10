import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../../src/mcp/server.js";
import { registerContextTools } from "../../src/mcp/tools/context-tools.js";
import { createMigratedTestDb, seedUs1Data, type TestDbContext } from "../helpers/test-db.js";

describe("MCP integration: context and skills tools", () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    seedUs1Data(ctx.db);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("libraxis_get_context returns ranked results and selected skill references", async () => {
    const server = createMcpServer();
    registerContextTools(server, ctx.db);

    const result = (await server.callTool("libraxis_get_context", {
      task_description: "validate workflow context",
      limit: 10
    })) as {
      results: Array<{ type: string }>;
      selected_skills: unknown[];
    };

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.some((item) => item.type === "skill")).toBe(true);
    expect(result.selected_skills.length).toBeGreaterThan(0);
  });

  it("libraxis_list_skills returns discoverable skills", async () => {
    const server = createMcpServer();
    registerContextTools(server, ctx.db);

    const result = (await server.callTool("libraxis_list_skills", {
      tags: ["automation"]
    })) as {
      items: Array<{ lineage_id: string }>;
    };

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.lineage_id).toBe("skill-a");
  });

  it("libraxis_load_skill resolves sub-skills and related mistakes/lessons", async () => {
    const server = createMcpServer();
    registerContextTools(server, ctx.db);

    const result = (await server.callTool("libraxis_load_skill", {
      skill_lineage_id: "skill-a"
    })) as {
      resolved_sub_skills: Array<{ lineage_id: string }>;
      related_mistakes: unknown[];
      related_lessons: unknown[];
    };

    expect(result.resolved_sub_skills).toHaveLength(1);
    expect(result.resolved_sub_skills[0]?.lineage_id).toBe("skill-b");
    expect(result.related_mistakes).toHaveLength(1);
    expect(result.related_lessons).toHaveLength(1);
  });

  it("excludes archived skills from list/context and blocks direct archived load", async () => {
    ctx.db.prepare("UPDATE entries SET status = 'archived' WHERE lineage_id = ?").run("skill-a");

    const server = createMcpServer();
    registerContextTools(server, ctx.db);

    const listed = (await server.callTool("libraxis_list_skills", {})) as {
      items: Array<{ lineage_id: string }>;
    };

    expect(listed.items.some((item) => item.lineage_id === "skill-a")).toBe(false);

    const context = (await server.callTool("libraxis_get_context", {
      task_description: "workflow context",
      limit: 20
    })) as {
      results: Array<{ lineage_id: string }>;
    };

    expect(context.results.some((item) => item.lineage_id === "skill-a")).toBe(false);

    const loadResult = await server.callTool("libraxis_load_skill", { skill_lineage_id: "skill-a" }) as { error: string };
    expect(loadResult.error).toBeDefined();
    expect(loadResult.error).toContain("Skill entry was not found");
  });
});
