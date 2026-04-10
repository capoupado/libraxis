import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import { createEntry, searchEntries, updateEntry } from "../../service/entries.js";
import { linkEntries } from "../../service/links.js";
import {
  createEntrySchema,
  linkEntriesSchema,
  parseOrThrow,
  updateEntrySchema
} from "../../service/validation/schemas.js";
import { getEntryGraph } from "../../service/related.js";
import { getLatestEntryByLineage } from "../../db/queries/entry-queries.js";
import { listSuggestedLinks } from "../../db/queries/link-queries.js";

interface UpdateParams {
  lineageId: string;
}

interface SearchQuery {
  q?: string;
  limit?: number;
}

interface GraphQuery {
  depth?: number;
  signals?: string;
  direction?: string;
  relation_types?: string;
}

export async function registerEntriesRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  app.post("/entries", async (request) => {
    const body = parseOrThrow(createEntrySchema, request.body, "Invalid create-entry payload");

    return createEntry(db, {
      ...body,
      created_by: body.created_by ?? "http-client"
    });
  });

  app.post<{ Params: UpdateParams }>("/entries/:lineageId/versions", async (request) => {
    const body = parseOrThrow(updateEntrySchema, request.body, "Invalid update-entry payload");

    return updateEntry(db, {
      lineage_id: request.params.lineageId,
      expected_version: body.expected_version,
      title: body.title,
      body_markdown: body.body_markdown,
      metadata: body.metadata,
      tags: body.tags,
      created_by: body.created_by ?? "http-client",
      allow_skill_direct_update: false
    });
  });

  app.get<{ Querystring: SearchQuery }>("/entries/search", async (request) => {
    const q = request.query.q ?? "";
    const limit = request.query.limit ?? 20;
    return {
      items: searchEntries(db, q, limit)
    };
  });

  app.post("/links", async (request) => {
    const body = parseOrThrow(linkEntriesSchema, request.body, "Invalid link payload");

    return linkEntries(db, {
      source_entry_id: body.source_entry_id,
      target_entry_id: body.target_entry_id,
      relation_type: body.relation_type,
      created_by: body.created_by ?? "http-client"
    });
  });

  // ─── Related-graph routes ──────────────────────────────────────────────────

  app.get<{ Params: UpdateParams; Querystring: GraphQuery }>(
    "/entries/:lineageId/graph",
    async (request) => {
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

  app.get<{ Params: UpdateParams }>(
    "/entries/:lineageId/suggested-links",
    async (request) => {
      const entry = getLatestEntryByLineage(db, request.params.lineageId);
      if (!entry) {
        return { suggestions: [] };
      }
      return { suggestions: listSuggestedLinks(db, entry.id) };
    }
  );
}
