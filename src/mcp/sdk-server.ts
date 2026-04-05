import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type Database from "better-sqlite3";
import { authenticateApiKey } from "../service/api-keys.js";
import { toMcpErrorEnvelope } from "./errors.js";
import { registerAllMcpTools } from "./register-all-tools.js";
import { createMcpServer } from "./server.js";
import { getRequiredScope } from "./tool-scope.js";

const entryTypeSchema = z.enum([
  "prompt", "run", "mistake", "lesson", "note", "skill",
  "user", "feedback", "project", "reference"
]);
const writableEntryTypeSchema = z.enum([
  "lesson", "note", "skill",
  "user", "feedback", "project", "reference"
]);
const apiScopeSchema = z.enum(["read", "write", "admin"]);
const proposalStatusSchema = z.enum(["pending", "approved", "rejected"]);

const TOOL_METADATA = {
  libraxis_get_agent_briefing: {
    description:
      "Call at the start of any session — no arguments needed. Returns the most recent user profile, feedback, and project context entries so you can orient yourself before starting work.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(20).optional()
    }).optional()
  },
  libraxis_get_context: {
    description:
      "Get a ranked context bundle for an upcoming task. Use task_description to describe what you are about to do. " +
      "Optionally filter by include_types. Valid types: " +
      "note (freeform observation), lesson (distilled learning), skill (reusable instructions), " +
      "user (user profile / preferences), feedback (corrections from user), " +
      "project (active project context), reference (external link or resource), " +
      "prompt (saved prompt template), mistake (error record), run (execution log).",
    inputSchema: z.object({
      task_description: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
      include_types: z.array(entryTypeSchema).optional()
    })
  },
  libraxis_list_skills: {
    description: "List discoverable skills with optional filters.",
    inputSchema: z
      .object({
        tags: z.array(z.string().min(1)).optional(),
        skill_type: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional()
      })
      .optional()
  },
  libraxis_load_skill: {
    description: "Load an existing skill by lineage ID or entry ID.",
    inputSchema: z.object({
      skill_lineage_id: z.string().min(1).optional(),
      skill_entry_id: z.string().min(1).optional()
    })
  },
  libraxis_create_entry: {
    description:
      "Create a new entry. Choose the type that best fits the content:\n" +
      "  user       — who the user is: role, preferences, background, working style\n" +
      "  feedback   — correction or guidance the user gave you; what to avoid or repeat\n" +
      "  project    — active project context: goals, constraints, decisions, deadlines\n" +
      "  reference  — external resource: URL, doc, tool, or named external system\n" +
      "  skill      — reusable step-by-step instructions or workflow\n" +
      "  lesson     — distilled insight or learning worth persisting\n" +
      "  note       — freeform observation that does not fit another type\n" +
      "Do not provide lineage_id when creating.",
    inputSchema: z.object({
      type: writableEntryTypeSchema,
      title: z.string().min(1),
      body_markdown: z.string().min(1),
      metadata: z.record(z.string(), z.unknown()).optional(),
      tags: z.array(z.string().min(1)).optional(),
      created_by: z.string().min(1).optional()
    })
  },
  libraxis_update_entry: {
    description:
      "Append a new version to an existing entry lineage. Requires lineage_id and expected_version.",
    inputSchema: z.object({
      lineage_id: z.string().min(1),
      expected_version: z.number().int().positive(),
      body_markdown: z.string().min(1),
      title: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      tags: z.array(z.string().min(1)).optional(),
      created_by: z.string().min(1).optional()
    })
  },
  libraxis_log_mistake_with_lesson: {
    description: "Create linked mistake and lesson entries in a single call.",
    inputSchema: z.object({
      mistake_title: z.string().min(1),
      mistake_body: z.string().min(1),
      lesson_title: z.string().min(1),
      lesson_body: z.string().min(1),
      tags: z.array(z.string().min(1)).optional(),
      created_by: z.string().min(1).optional()
    })
  },
  libraxis_link_entries: {
    description: "Create a directional relationship between two existing entries.",
    inputSchema: z.object({
      source_entry_id: z.string().min(1),
      target_entry_id: z.string().min(1),
      relation_type: z.string().min(1),
      created_by: z.string().min(1).optional()
    })
  },
  libraxis_propose_skill_improvement: {
    description:
      "Submit a proposal to improve or archive an existing skill lineage. Requires an existing skill_lineage_id.",
    inputSchema: z.object({
      skill_lineage_id: z.string().min(1),
      proposal_markdown: z.string().min(1),
      rationale: z.string().min(1),
      action_type: z.enum(["improve", "archive"]).optional(),
      proposer: z.string().min(1).optional()
    })
  },
  libraxis_list_skill_proposals: {
    description: "List skill proposals with optional status filtering.",
    inputSchema: z
      .object({
        status: proposalStatusSchema.optional()
      })
      .optional()
  },
  libraxis_review_skill_proposal: {
    description: "Approve or reject a pending skill proposal.",
    inputSchema: z.object({
      proposal_id: z.string().min(1),
      decision: z.enum(["approve", "reject"]),
      decision_notes: z.string().optional(),
      decided_by: z.string().min(1).optional()
    })
  },
  libraxis_skill_dashboard: {
    description: "Return aggregate skill performance and proposal metrics.",
    inputSchema: z.object({}).optional()
  },
  libraxis_api_key_create: {
    description: "Create a machine API key with specific scopes.",
    inputSchema: z.object({
      name: z.string().min(1),
      scopes: z.array(apiScopeSchema)
    })
  },
  libraxis_api_key_list: {
    description: "List existing machine API keys and status.",
    inputSchema: z.object({}).optional()
  },
  libraxis_api_key_revoke: {
    description: "Revoke an existing machine API key.",
    inputSchema: z.object({
      key_id: z.string().min(1)
    })
  },
  libraxis_export_entry_markdown: {
    description: "Export an existing entry to markdown by entry_id or lineage_id.",
    inputSchema: z.object({
      entry_id: z.string().optional(),
      lineage_id: z.string().optional()
    })
  },
  libraxis_upload_agent: {
    description:
      "Upload a reusable agent package only. Do not use this tool for generic skill creation.",
    inputSchema: z.object({
      agent_intent: z.literal("agent_package"),
      title: z.string().min(1),
      body_markdown: z.string().min(1),
      metadata: z.record(z.string(), z.unknown()).optional(),
      tags: z.array(z.string().min(1)).optional(),
      created_by: z.string().min(1).optional()
    })
  },
  libraxis_list_agents: {
    description: "List uploaded reusable agents with optional filtering.",
    inputSchema: z
      .object({
        tags: z.array(z.string().min(1)).optional(),
        limit: z.number().int().min(1).max(100).optional()
      })
      .optional()
  },
  libraxis_load_agent: {
    description: "Load an existing agent by lineage ID or entry ID.",
    inputSchema: z.object({
      agent_lineage_id: z.string().min(1).optional(),
      agent_entry_id: z.string().min(1).optional()
    })
  }
} as const satisfies Record<string, { description: string; inputSchema: z.ZodTypeAny }>;

function getToolMetadata(toolName: string): { description: string; inputSchema: z.ZodTypeAny } {
  if (toolName in TOOL_METADATA) {
    return TOOL_METADATA[toolName as keyof typeof TOOL_METADATA];
  }

  return {
    description: `Libraxis tool: ${toolName}`,
    inputSchema: z.any()
  };
}

function serializePayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }

  try {
    return JSON.stringify(payload, null, 2) ?? "null";
  } catch {
    return String(payload);
  }
}

export function createAuthenticatedSdkMcpServer(
  db: Database.Database,
  apiKey: string
): { server: McpServer; toolCount: number } {
  const internalServer = createMcpServer();
  registerAllMcpTools(internalServer, db);

  const mcpServer = new McpServer({
    name: "libraxis",
    version: "1.0.0"
  });

  const toolNames = internalServer.registry.list();

  for (const toolName of toolNames) {
    const toolMetadata = getToolMetadata(toolName);

    mcpServer.registerTool(
      toolName,
      {
        description: toolMetadata.description,
        inputSchema: toolMetadata.inputSchema
      },
      async (args: unknown) => {
        try {
          const requiredScope = getRequiredScope(toolName);
          authenticateApiKey(db, apiKey, requiredScope);

          const result = await internalServer.callTool(toolName, args ?? {});
          return {
            content: [{ type: "text", text: serializePayload(result) }]
          };
        } catch (error) {
          const envelope = toMcpErrorEnvelope(error, { toolName });
          return {
            isError: true,
            content: [{ type: "text", text: serializePayload(envelope) }]
          };
        }
      }
    );
  }

  return {
    server: mcpServer,
    toolCount: toolNames.length
  };
}