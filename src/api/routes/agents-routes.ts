import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import { enforceCsrf, requireOwnerSession } from "../middleware/session-auth.js";
import { deleteAgent, listAgents, loadAgent, uploadAgent } from "../../service/agents.js";
import { parseOrThrow, uploadAgentSchema } from "../../service/validation/schemas.js";

interface AgentListQuery {
  tags?: string;
  limit?: number;
}

interface AgentLoadParams {
  lineageId: string;
}

interface AgentDeleteParams {
  lineageId: string;
}

export async function registerAgentsRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  app.get<{ Querystring: AgentListQuery }>("/agents", async (request) => {
    const tags = request.query.tags
      ? request.query.tags
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter((item) => item.length > 0)
      : undefined;

    return {
      items: listAgents(db, {
        tags,
        limit: request.query.limit
      }),
      next_cursor: null
    };
  });

  app.get<{ Params: AgentLoadParams }>("/agents/:lineageId/load", async (request) => {
    return loadAgent(db, {
      agent_lineage_id: request.params.lineageId
    });
  });

  app.post("/owner/agents", async (request, reply) => {
    const { session } = requireOwnerSession(request, reply, db);
    enforceCsrf(request, session);

    const body = parseOrThrow(uploadAgentSchema, request.body, "Invalid upload-agent payload");

    return uploadAgent(db, {
      title: body.title,
      body_markdown: body.body_markdown,
      metadata: body.metadata,
      tags: body.tags,
      created_by: session.owner_username
    });
  });

  app.delete<{ Params: AgentDeleteParams }>("/owner/agents/:lineageId", async (request, reply) => {
    const { session } = requireOwnerSession(request, reply, db);
    enforceCsrf(request, session);

    return deleteAgent(db, {
      agent_lineage_id: request.params.lineageId
    });
  });
}
