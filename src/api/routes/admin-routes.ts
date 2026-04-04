import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { enforceCsrf, requireOwnerSession } from "../middleware/session-auth.js";
import { authenticateApiKey, createMachineApiKey, listMachineApiKeys, revokeMachineApiKey } from "../../service/api-keys.js";
import { createEntry } from "../../service/entries.js";
import { exportEntryMarkdown } from "../../service/export.js";
import { DomainError } from "../../service/errors.js";
import {
  createApiKeySchema,
  createEntrySchema,
  parseOrThrow
} from "../../service/validation/schemas.js";

function requireApiKey(
  db: Database.Database,
  request: FastifyRequest,
  _reply: FastifyReply,
  requiredScope: "read" | "write"
): void {
  const key = request.headers["x-api-key"];
  if (typeof key !== "string" || key.length === 0) {
    throw new DomainError("AUTH_REQUIRED", "Missing x-api-key header");
  }

  authenticateApiKey(db, key, requiredScope);
}

export async function registerAdminRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  app.post("/admin/api-keys", async (request, reply) => {
    const { session } = requireOwnerSession(request, reply, db);
    enforceCsrf(request, session);

    const body = parseOrThrow(createApiKeySchema, request.body, "Invalid create API key payload");
    return createMachineApiKey(db, body);
  });

  app.get("/admin/api-keys", async (request, reply) => {
    requireOwnerSession(request, reply, db);
    return {
      keys: listMachineApiKeys(db)
    };
  });

  app.post<{ Params: { keyId: string } }>("/admin/api-keys/:keyId/revoke", async (request, reply) => {
    const { session } = requireOwnerSession(request, reply, db);
    enforceCsrf(request, session);
    return revokeMachineApiKey(db, request.params.keyId);
  });

  app.get<{ Params: { lineageId: string } }>("/admin/entries/:lineageId/export", async (request, reply) => {
    requireApiKey(db, request, reply, "read");
    return exportEntryMarkdown(db, { lineage_id: request.params.lineageId });
  });

  app.post("/admin/entries", async (request, reply) => {
    requireApiKey(db, request, reply, "write");
    const body = parseOrThrow(createEntrySchema, request.body, "Invalid admin create-entry payload");

    return createEntry(db, {
      ...body,
      created_by: "api-key-client"
    });
  });
}
