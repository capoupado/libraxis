import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import {
  enforceCsrf,
  loginOwner,
  logoutOwner,
  requireOwnerSession
} from "../middleware/session-auth.js";
import {
  archiveEntry,
  createEntry,
  getEntryHistory,
  searchEntries,
  updateEntry
} from "../../service/entries.js";
import {
  createEntrySchema,
  ownerEntriesQuerySchema,
  ownerLoginSchema,
  parseOrThrow,
  updateEntrySchema
} from "../../service/validation/schemas.js";
import { env } from "../../config/env.js";

interface SearchQuery {
  q?: string;
  limit?: number;
}

interface LineageParams {
  lineageId: string;
}

export async function registerOwnerEntriesRoutes(
  app: FastifyInstance,
  db: Database.Database
): Promise<void> {
  app.post("/owner/login", async (request, reply) => {
    const body = parseOrThrow(ownerLoginSchema, request.body, "Invalid owner login payload");
    const { session } = loginOwner(db, body.username, body.password);

    reply.setCookie("lbx_session", session.id, {
      httpOnly: true,
      sameSite: "strict",
      secure: env.LIBRAXIS_COOKIE_SECURE,
      path: "/"
    });

    return {
      csrf_token: session.csrf_token,
      expires_at: session.expires_at
    };
  });

  app.get("/owner/session", async (request, reply) => {
    const { session } = requireOwnerSession(request, reply, db);

    return {
      csrf_token: session.csrf_token,
      expires_at: session.expires_at,
      owner_username: session.owner_username
    };
  });

  app.post("/owner/logout", async (request, reply) => {
    const { session } = requireOwnerSession(request, reply, db);
    enforceCsrf(request, session);
    logoutOwner(db, session.id);
    reply.clearCookie("lbx_session", { path: "/" });
    return { logged_out: true };
  });

  app.get<{ Querystring: SearchQuery }>("/owner/entries", async (request, reply) => {
    requireOwnerSession(request, reply, db);
    const query = parseOrThrow(
      ownerEntriesQuerySchema,
      request.query,
      "Invalid owner entries query"
    );

    const q = query.q;
    const limit = query.limit;

    return {
      items: searchEntries(db, q, limit)
    };
  });

  app.get<{ Params: LineageParams }>("/owner/entries/:lineageId", async (request, reply) => {
    requireOwnerSession(request, reply, db);
    const history = getEntryHistory(db, request.params.lineageId);
    return {
      latest: history[0] ?? null,
      history
    };
  });

  app.post("/owner/entries", async (request, reply) => {
    const { session } = requireOwnerSession(request, reply, db);
    enforceCsrf(request, session);

    const body = parseOrThrow(createEntrySchema, request.body, "Invalid owner create-entry payload");

    return createEntry(db, {
      ...body,
      created_by: session.owner_username
    });
  });

  app.post<{ Params: LineageParams }>("/owner/entries/:lineageId/edit", async (request, reply) => {
    const { session } = requireOwnerSession(request, reply, db);
    enforceCsrf(request, session);

    const body = parseOrThrow(updateEntrySchema, request.body, "Invalid owner edit-entry payload");

    return updateEntry(db, {
      lineage_id: request.params.lineageId,
      expected_version: body.expected_version,
      title: body.title,
      body_markdown: body.body_markdown,
      metadata: body.metadata,
      tags: body.tags,
      created_by: session.owner_username,
      allow_skill_direct_update: true
    });
  });

  app.delete<{ Params: LineageParams }>("/owner/entries/:lineageId", async (request, reply) => {
    const { session } = requireOwnerSession(request, reply, db);
    enforceCsrf(request, session);

    return archiveEntry(db, request.params.lineageId);
  });
}
