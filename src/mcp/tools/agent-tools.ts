import type Database from "better-sqlite3";
import { z } from "zod";

import type { BaseMcpServer } from "../server.js";
import { listAgents, loadAgent, uploadAgent } from "../../service/agents.js";

const uploadAgentSchema = z.object({
  agent_intent: z.literal("agent_package"),
  title: z.string().min(1),
  body_markdown: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().min(1)).optional(),
  created_by: z.string().min(1).default("agent")
});

const listAgentsSchema = z.object({
  tags: z.array(z.string().min(1)).optional(),
  limit: z.number().int().min(1).max(100).optional()
});

const loadAgentSchema = z
  .object({
    agent_lineage_id: z.string().min(1).optional(),
    agent_entry_id: z.string().min(1).optional()
  })
  .refine((value) => Boolean(value.agent_lineage_id || value.agent_entry_id), {
    message: "Either agent_lineage_id or agent_entry_id is required"
  });

export function registerAgentTools(server: BaseMcpServer, db: Database.Database): void {
  server.registerTool("libraxis_upload_agent", async (input) => {
    const { agent_intent: _agentIntent, ...parsed } = uploadAgentSchema.parse(input);
    return uploadAgent(db, parsed);
  });

  server.registerTool("libraxis_list_agents", async (input) => {
    const parsed = listAgentsSchema.parse(input ?? {});
    return {
      items: listAgents(db, parsed),
      next_cursor: null
    };
  });

  server.registerTool("libraxis_load_agent", async (input) => {
    const parsed = loadAgentSchema.parse(input);
    return loadAgent(db, parsed);
  });
}
