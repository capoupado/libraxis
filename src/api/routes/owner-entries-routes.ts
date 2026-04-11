import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

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
  relationSchema,
  updateEntrySchema
} from "../../service/validation/schemas.js";
import { env } from "../../config/env.js";
import { getEntryGraph, promoteSuggestion } from "../../service/related.js";
import { getLatestEntryByLineage } from "../../db/queries/entry-queries.js";
import { listSuggestedLinks } from "../../db/queries/link-queries.js";

import {
  parseGraphDirection,
  parseGraphRelationTypes,
  parseGraphSignals,
  validSignals
} from "./_graph-query.js";

const depthSchema = z.coerce.number().int().min(1).max(10).catch(2);
const limitSchema = z.coerce.number().int().min(1).max(500).catch(200);
const promoteSchema = z.object({ relation_type: relationSchema });

interface SearchQuery {
  q?: string;
  limit?: number;
}

interface LineageParams {
  lineageId: string;
}

interface GraphQuery {
  depth?: number;
  signals?: string;
  direction?: string;
  relation_types?: string;
}

interface GlobalGraphQuery {
  limit?: number;
}

interface SuggestedLinkIdParams {
  id: string;
}

interface PromoteBody {
  relation_type: string;
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

  // ─── Related-graph routes ──────────────────────────────────────────────────

  app.get<{ Params: LineageParams; Querystring: GraphQuery }>(
    "/owner/entries/:lineageId/graph",
    async (request, reply) => {
      requireOwnerSession(request, reply, db);

      const { lineageId } = request.params;
      const depth = depthSchema.parse(request.query.depth);
      let signals: Array<(typeof validSignals)[number]>;
      let direction: "out" | "in" | "both";
      let relationTypes: string[] | undefined;

      try {
        signals = parseGraphSignals(request.query.signals);
        direction = parseGraphDirection(request.query.direction);
        relationTypes = parseGraphRelationTypes(request.query.relation_types);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid graph query parameters.";
        return reply.code(400).send({ error: "INVALID_INPUT", message });
      }

      return getEntryGraph(db, lineageId, { depth, signals, direction, relationTypes });
    }
  );

  app.get<{ Querystring: GlobalGraphQuery }>("/owner/graph", async (request, reply) => {
    requireOwnerSession(request, reply, db);

    const limit = limitSchema.parse(request.query.limit);

    // Step 1: fetch top-N entries by combined link degree
    interface DegreeRow {
      id: string;
      lineage_id: string;
      title: string;
      type: string;
      degree: number;
    }
    const topEntries = db
      .prepare<[number], DegreeRow>(
        `SELECT e.id, e.lineage_id, e.title, e.type,
                COALESCE(d.degree, 0) AS degree
         FROM entries e
         LEFT JOIN (
           SELECT x.self_id, COUNT(*) AS degree
           FROM (
             SELECT el.source_entry_id AS self_id, el.target_entry_id AS other_id
             FROM entry_links el
             UNION ALL
             SELECT el.target_entry_id AS self_id, el.source_entry_id AS other_id
             FROM entry_links el
           ) x
           JOIN entries eo ON eo.id = x.other_id
           WHERE eo.is_latest = 1 AND eo.status = 'active'
           GROUP BY x.self_id
         ) d ON d.self_id = e.id
         WHERE e.is_latest = 1 AND e.status = 'active'
         ORDER BY degree DESC
         LIMIT ?`
      )
      .all(limit);

    if (topEntries.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Build id → entry map for node hydration
    const nodeMap = new Map<string, DegreeRow>(topEntries.map((e) => [e.id, e]));

    // Step 2: fetch all entry_links where BOTH endpoints are in the top-N set
    const placeholders = topEntries.map(() => "?").join(", ");
    const entryIds = topEntries.map((e) => e.id);

    interface LinkRow {
      id: string;
      source_entry_id: string;
      target_entry_id: string;
      relation_type: string;
    }
    const links = db
      .prepare<string[], LinkRow>(
        `SELECT id, source_entry_id, target_entry_id, relation_type
         FROM entry_links
         WHERE source_entry_id IN (${placeholders})
           AND target_entry_id IN (${placeholders})`
      )
      .all(...entryIds, ...entryIds);

    // Step 3: resolve entry_ids to lineage_ids; deduplicate edges by lineage pair
    const edgeMap = new Map<string, {
      source_lineage_id: string;
      target_lineage_id: string;
      relation_type: string;
      signal: "explicit";
      score: number;
    }>();
    for (const link of links) {
      const src = nodeMap.get(link.source_entry_id);
      const tgt = nodeMap.get(link.target_entry_id);
      if (!src || !tgt) continue;
      const key = `${src.lineage_id}::${tgt.lineage_id}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          source_lineage_id: src.lineage_id,
          target_lineage_id: tgt.lineage_id,
          relation_type: link.relation_type,
          signal: "explicit",
          score: 1,
        });
      }
    }

    // Keep top-N nodes and expose degree for UI sizing/debugging.
    const nodes = topEntries.map((e) => ({
      lineage_id: e.lineage_id,
      entry_id: e.id,
      title: e.title,
      type: e.type,
      depth: 1,
      degree: e.degree,
    }));

    return {
      nodes,
      edges: Array.from(edgeMap.values()),
    };
  });

  app.get<{ Params: LineageParams }>(
    "/owner/entries/:lineageId/suggested-links",
    async (request, reply) => {
      requireOwnerSession(request, reply, db);

      const entry = getLatestEntryByLineage(db, request.params.lineageId);
      if (!entry) {
        return { suggestions: [] };
      }

      return { suggestions: listSuggestedLinks(db, entry.id) };
    }
  );

  app.post<{ Params: SuggestedLinkIdParams; Body: PromoteBody }>(
    "/owner/suggested-links/:id/promote",
    async (request, reply) => {
      const { session } = requireOwnerSession(request, reply, db);
      enforceCsrf(request, session);

      const { id } = request.params;
      const parseResult = promoteSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({ error: "INVALID_INPUT", message: parseResult.error.message });
      }
      const { relation_type } = parseResult.data;

      try {
        const linkId = promoteSuggestion(db, id, relation_type, "owner");
        return { link_id: linkId };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: "VALIDATION_ERROR", message });
      }
    }
  );
}
