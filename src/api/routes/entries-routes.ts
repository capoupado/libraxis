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

interface UpdateParams {
  lineageId: string;
}

interface SearchQuery {
  q?: string;
  limit?: number;
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
}
