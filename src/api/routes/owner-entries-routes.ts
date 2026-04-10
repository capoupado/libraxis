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
import { getEntryGraph, promoteSuggestion } from "../../service/related.js";
import { getLatestEntryByLineage } from "../../db/queries/entry-queries.js";
import { listSuggestedLinks } from "../../db/queries/link-queries.js";

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
      const depth = request.query.depth !== undefined ? Number(request.query.depth) : 2;
      const signals = request.query.signals
        ? (request.query.signals.split(",").map((s) => s.trim()) as Array<"explicit" | "tag" | "fts">)
        : (["explicit", "tag", "fts"] as Array<"explicit" | "tag" | "fts">);
      const direction = (request.query.direction ?? "both") as "out" | "in" | "both";
      const relationTypes = request.query.relation_types
        ? request.query.relation_types.split(",").map((s) => s.trim())
        : undefined;

      return getEntryGraph(db, lineageId, { depth, signals, direction, relationTypes });
    }
  );

  app.get<{ Querystring: GlobalGraphQuery }>("/owner/graph", async (request, reply) => {
    requireOwnerSession(request, reply, db);

    const rawLimit = request.query.limit !== undefined ? Number(request.query.limit) : 200;
    const limit = Math.min(rawLimit, 500);

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
                COUNT(el.id) AS degree
         FROM entries e
         LEFT JOIN entry_links el
           ON el.source_entry_id = e.id OR el.target_entry_id = e.id
         WHERE e.is_latest = 1
         GROUP BY e.id
         ORDER BY degree DESC
         LIMIT ?`
      )
      .all(limit);

    if (topEntries.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Build id → entry map for node hydration
    const entryIdSet = new Set(topEntries.map((e) => e.id));
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
    const edgeMap = new Map<string, { source_lineage_id: string; target_lineage_id: string; relation_type: string }>();
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
        });
      }
    }

    // Filter nodes to only those involved in at least one edge (or keep all top-N)
    const nodes = topEntries.map((e) => ({
      lineage_id: e.lineage_id,
      title: e.title,
      type: e.type,
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
      const { relation_type } = request.body ?? {};

      if (!relation_type) {
        reply.status(400);
        return { error: "relation_type is required" };
      }

      try {
        const linkId = promoteSuggestion(db, id, relation_type, "owner");
        return { link_id: linkId };
      } catch (err) {
        reply.status(400);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
}
