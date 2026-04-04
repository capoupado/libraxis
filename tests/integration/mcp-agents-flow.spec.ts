import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../../src/mcp/server.js";
import { registerAgentTools } from "../../src/mcp/tools/agent-tools.js";
import { createMigratedTestDb, type TestDbContext } from "../helpers/test-db.js";

describe("integration: MCP agent tools", () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createMigratedTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("uploads, lists, and loads agent entries", async () => {
    const mcp = createMcpServer();
    registerAgentTools(mcp, ctx.db);

    const uploaded = (await mcp.callTool("libraxis_upload_agent", {
      title: "Portable MCP Agent",
      body_markdown: "Follow this execution checklist for reusable behavior.",
      tags: ["portable", "agent"],
      metadata: {
        skill_type: "workflow",
        runtime: "mcp"
      },
      created_by: "integration"
    })) as { lineage_id: string; version_number: number };

    expect(uploaded.lineage_id).toBeDefined();
    expect(uploaded.version_number).toBe(1);

    const listed = (await mcp.callTool("libraxis_list_agents", {
      tags: ["portable"]
    })) as {
      items: Array<{ lineage_id: string; skill_type: string }>;
    };

    expect(listed.items.length).toBe(1);
    expect(listed.items[0]?.lineage_id).toBe(uploaded.lineage_id);
    expect(listed.items[0]?.skill_type).toBe("agent");

    const loaded = (await mcp.callTool("libraxis_load_agent", {
      agent_lineage_id: uploaded.lineage_id
    })) as {
      skill: {
        metadata: {
          skill_type: string;
          runtime: string;
        };
      };
    };

    expect(loaded.skill.metadata.skill_type).toBe("agent");
    expect(loaded.skill.metadata.runtime).toBe("mcp");
  });
});
