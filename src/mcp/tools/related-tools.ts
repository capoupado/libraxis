import type Database from "better-sqlite3";
import { z } from "zod";

import type { BaseMcpServer } from "../server.js";
import { getEntryById, getLatestEntryByLineage, searchEntriesFts } from "../../db/queries/entry-queries.js";
import { listOutgoingLinks, listIncomingLinks, listSuggestedLinks } from "../../db/queries/link-queries.js";
import { getEntryGraph, promoteSuggestion } from "../../service/related.js";
import { searchEntries } from "../../service/entries.js";
import { relationSchema } from "../../service/validation/schemas.js";

// ─── Tool 1: libraxis_get_entry ───────────────────────────────────────────────

const getEntrySchema = z.object({
  entry_id: z.string().optional(),
  lineage_id: z.string().optional(),
  include_links: z.boolean().optional().default(false),
  include_backlinks: z.boolean().optional().default(false),
});

// ─── Tool 2: libraxis_list_related ───────────────────────────────────────────

const listRelatedSchema = z.object({
  entry_lineage_id: z.string(),
  depth: z.number().int().min(1).max(5).optional().default(2),
  signals: z
    .array(z.enum(["explicit", "tag", "fts"]))
    .optional()
    .default(["explicit", "tag", "fts"]),
  relation_types: z.array(relationSchema).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
  direction: z.enum(["out", "in", "both"]).optional().default("both"),
});

// ─── Tool 3: libraxis_search_entries ─────────────────────────────────────────

const searchEntriesSchema = z.object({
  query: z.string().min(1),
  types: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  mode: z.enum(["fts", "like"]).optional().default("fts"),
});

// ─── Tool 4: libraxis_list_suggested_links ────────────────────────────────────

const listSuggestedLinksSchema = z.object({
  entry_id: z.string().optional().describe('If omitted, returns all suggested links across all entries'),
});

// ─── Tool 5: libraxis_promote_suggested_link ──────────────────────────────────

const promoteSuggestedLinkSchema = z.object({
  id: z.string(),
  relation_type: relationSchema,
});

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerRelatedTools(server: BaseMcpServer, db: Database.Database): void {
  // Tool 1
  server.registerTool("libraxis_get_entry", async (input) => {
    const parsed = getEntrySchema.parse(input);

    if (!parsed.entry_id && !parsed.lineage_id) {
      return { error: "At least one of entry_id or lineage_id must be provided." };
    }

    let entry;
    if (parsed.lineage_id) {
      entry = getLatestEntryByLineage(db, parsed.lineage_id);
    } else {
      entry = getEntryById(db, parsed.entry_id!);
    }

    if (!entry) {
      return { error: "Entry not found." };
    }

    const result: Record<string, unknown> = { entry };

    if (parsed.include_links || parsed.include_backlinks) {
      result.incoming_links = listIncomingLinks(db, entry.id);
    }
    if (parsed.include_links) {
      result.outgoing_links = listOutgoingLinks(db, entry.id);
    }

    return result;
  });

  // Tool 2
  server.registerTool("libraxis_list_related", async (input) => {
    const parsed = listRelatedSchema.parse(input);
    const graph = getEntryGraph(db, parsed.entry_lineage_id, {
      depth: parsed.depth,
      signals: parsed.signals,
      relationTypes: parsed.relation_types,
      direction: parsed.direction,
      limit: parsed.limit,
    });
    return graph;
  });

  // Tool 3
  server.registerTool("libraxis_search_entries", async (input) => {
    const parsed = searchEntriesSchema.parse(input);

    if (parsed.mode === "fts") {
      const results = searchEntriesFts(db, parsed.query, {
        types: parsed.types,
        limit: parsed.limit,
      });
      return { results, mode: "fts" };
    } else {
      const allResults = searchEntries(db, parsed.query, parsed.limit);
      const filtered = parsed.types && parsed.types.length > 0
        ? allResults.filter((r) => parsed.types!.includes(r.type))
        : allResults;
      return { results: filtered, mode: "like" };
    }
  });

  // Tool 4
  server.registerTool("libraxis_list_suggested_links", async (input) => {
    const parsed = listSuggestedLinksSchema.parse(input);
    const suggestions = listSuggestedLinks(db, parsed.entry_id);
    return { suggestions };
  });

  // Tool 5
  server.registerTool("libraxis_promote_suggested_link", async (input) => {
    const parsed = promoteSuggestedLinkSchema.parse(input);
    const link_id = promoteSuggestion(db, parsed.id, parsed.relation_type, "agent");
    return { link_id };
  });
}
