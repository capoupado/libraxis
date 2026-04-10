import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";

import { createMigratedTestDb, type TestDbContext } from "../helpers/test-db.js";
import { createMcpServer, type BaseMcpServer } from "../../src/mcp/server.js";
import { registerRelatedTools } from "../../src/mcp/tools/related-tools.js";

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function seedEntry(
  db: Database.Database,
  id: string,
  lineageId: string,
  title = "Entry " + id,
  body = "body of " + id,
  type = "note"
) {
  db.prepare(
    `INSERT INTO entries(id, lineage_id, type, title, body_markdown, metadata_json, version_number, is_latest, created_by)
     VALUES (?, ?, ?, ?, ?, '{}', 1, 1, 'test')`
  ).run(id, lineageId, type, title, body);
}

function seedLink(
  db: Database.Database,
  id: string,
  src: string,
  tgt: string,
  rel = "related_to"
) {
  db.prepare(
    "INSERT INTO entry_links(id, source_entry_id, target_entry_id, relation_type, created_by) VALUES (?, ?, ?, ?, 'test')"
  ).run(id, src, tgt, rel);
}

function seedSuggestedLink(
  db: Database.Database,
  id: string,
  src: string,
  tgt: string,
  signal = "tag",
  score = 0.5
) {
  db.prepare(
    `INSERT INTO suggested_links(id, source_entry_id, target_entry_id, signal, score, rationale)
     VALUES (?, ?, ?, ?, ?, 'test rationale')`
  ).run(id, src, tgt, signal, score);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("mcp related tools", () => {
  let ctx: TestDbContext;
  let db: Database.Database;
  let server: BaseMcpServer;

  beforeEach(() => {
    ctx = createMigratedTestDb();
    db = ctx.db;
    server = createMcpServer();
    registerRelatedTools(server, db);

    seedEntry(db, "entry-a", "lineage-a", "Alpha Entry", "alpha content about automation");
    seedEntry(db, "entry-b", "lineage-b", "Beta Entry", "beta content about automation");
    seedEntry(db, "entry-c", "lineage-c", "Gamma Entry", "gamma content");

    seedLink(db, "link-ab", "entry-a", "entry-b", "related_to");
  });

  afterEach(() => ctx.cleanup());

  // ─── libraxis_get_entry ───────────────────────────────────────────────────

  describe("libraxis_get_entry", () => {
    it("returns entry when lineage_id is provided", async () => {
      const result = await server.callTool("libraxis_get_entry", {
        lineage_id: "lineage-a",
      }) as { entry: { id: string; lineage_id: string } };

      expect(result.entry).toBeDefined();
      expect(result.entry.id).toBe("entry-a");
      expect(result.entry.lineage_id).toBe("lineage-a");
    });

    it("returns entry when entry_id is provided", async () => {
      const result = await server.callTool("libraxis_get_entry", {
        entry_id: "entry-b",
      }) as { entry: { id: string } };

      expect(result.entry).toBeDefined();
      expect(result.entry.id).toBe("entry-b");
    });

    it("returns error when neither entry_id nor lineage_id is provided", async () => {
      const result = await server.callTool("libraxis_get_entry", {}) as { error: string };
      expect(result.error).toMatch(/entry_id or lineage_id/);
    });

    it("returns entry not found when id does not exist", async () => {
      const result = await server.callTool("libraxis_get_entry", {
        entry_id: "nonexistent",
      }) as { error: string };
      expect(result.error).toBe("Entry not found.");
    });

    it("includes links when include_links=true", async () => {
      const result = await server.callTool("libraxis_get_entry", {
        lineage_id: "lineage-a",
        include_links: true,
      }) as { entry: unknown; outgoing_links: unknown[]; incoming_links: unknown[] };

      expect(result.outgoing_links).toBeDefined();
      expect(result.incoming_links).toBeDefined();
      expect(Array.isArray(result.outgoing_links)).toBe(true);
      expect(result.outgoing_links.length).toBe(1);
    });

    it("includes only incoming links when include_backlinks=true", async () => {
      const result = await server.callTool("libraxis_get_entry", {
        lineage_id: "lineage-b",
        include_backlinks: true,
      }) as { entry: unknown; incoming_links: unknown[]; outgoing_links?: unknown[] };

      expect(result.incoming_links).toBeDefined();
      expect(result.incoming_links.length).toBe(1);
      expect(result.outgoing_links).toBeUndefined();
    });
  });

  // ─── libraxis_list_related ────────────────────────────────────────────────

  describe("libraxis_list_related", () => {
    it("returns graph shape with nodes and edges", async () => {
      const result = await server.callTool("libraxis_list_related", {
        entry_lineage_id: "lineage-a",
        signals: ["explicit"],
        depth: 1,
      }) as { nodes: unknown[]; edges: unknown[] };

      expect(result.nodes).toBeDefined();
      expect(result.edges).toBeDefined();
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(Array.isArray(result.edges)).toBe(true);
    });

    it("finds explicit neighbor via explicit signal", async () => {
      const result = await server.callTool("libraxis_list_related", {
        entry_lineage_id: "lineage-a",
        signals: ["explicit"],
      }) as { nodes: Array<{ lineage_id: string }> };

      const lineageIds = result.nodes.map((n) => n.lineage_id);
      expect(lineageIds).toContain("lineage-b");
    });

    it("returns empty graph for entry with no relations", async () => {
      const result = await server.callTool("libraxis_list_related", {
        entry_lineage_id: "lineage-c",
        signals: ["explicit"],
      }) as { nodes: unknown[]; edges: unknown[] };

      expect(result.nodes.length).toBe(0);
      expect(result.edges.length).toBe(0);
    });
  });

  // ─── libraxis_search_entries ──────────────────────────────────────────────

  describe("libraxis_search_entries", () => {
    it("mode=like returns matching results", async () => {
      const result = await server.callTool("libraxis_search_entries", {
        query: "alpha",
        mode: "like",
      }) as { results: Array<{ title: string }>; mode: string };

      expect(result.mode).toBe("like");
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results.some((r) => r.title.includes("Alpha"))).toBe(true);
    });

    it("mode=like filters by type", async () => {
      const result = await server.callTool("libraxis_search_entries", {
        query: "content",
        mode: "like",
        types: ["note"],
      }) as { results: Array<{ type: string }> };

      expect(result.results.every((r) => r.type === "note")).toBe(true);
    });

    it("mode=fts returns results array and correct mode label", async () => {
      const result = await server.callTool("libraxis_search_entries", {
        query: "automation",
        mode: "fts",
      }) as { results: unknown[]; mode: string };

      expect(result.mode).toBe("fts");
      expect(Array.isArray(result.results)).toBe(true);
    });

    it("mode=fts returns empty for query with only special chars", async () => {
      const result = await server.callTool("libraxis_search_entries", {
        query: "!!!",
        mode: "fts",
      }) as { results: unknown[] };

      expect(result.results.length).toBe(0);
    });
  });

  // ─── libraxis_list_suggested_links ────────────────────────────────────────

  describe("libraxis_list_suggested_links", () => {
    beforeEach(() => {
      seedSuggestedLink(db, "sugg-1", "entry-a", "entry-c", "tag", 0.7);
      seedSuggestedLink(db, "sugg-2", "entry-b", "entry-c", "fts", 0.4);
    });

    it("returns all suggestions when no entry_id given", async () => {
      const result = await server.callTool("libraxis_list_suggested_links", {}) as {
        suggestions: Array<{ id: string }>;
      };

      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(result.suggestions.length).toBe(2);
    });

    it("returns suggestions filtered by entry_id", async () => {
      const result = await server.callTool("libraxis_list_suggested_links", {
        entry_id: "entry-a",
      }) as { suggestions: Array<{ source_entry_id: string }> };

      expect(result.suggestions.length).toBe(1);
      expect(result.suggestions[0]!.source_entry_id).toBe("entry-a");
    });

    it("returns empty array when no suggestions exist", async () => {
      const result = await server.callTool("libraxis_list_suggested_links", {
        entry_id: "nonexistent",
      }) as { suggestions: unknown[] };

      expect(result.suggestions.length).toBe(0);
    });
  });

  // ─── libraxis_promote_suggested_link ─────────────────────────────────────

  describe("libraxis_promote_suggested_link", () => {
    beforeEach(() => {
      seedSuggestedLink(db, "sugg-promote", "entry-a", "entry-c", "tag", 0.6);
    });

    it("promotes suggestion and returns link_id", async () => {
      const result = await server.callTool("libraxis_promote_suggested_link", {
        id: "sugg-promote",
        relation_type: "related_to",
      }) as { link_id: string };

      expect(result.link_id).toBeDefined();
      expect(typeof result.link_id).toBe("string");
      expect(result.link_id.length).toBeGreaterThan(0);
    });

    it("removes suggestion after promotion", async () => {
      await server.callTool("libraxis_promote_suggested_link", {
        id: "sugg-promote",
        relation_type: "related_to",
      });

      const listResult = await server.callTool("libraxis_list_suggested_links", {
        entry_id: "entry-a",
      }) as { suggestions: unknown[] };

      expect(listResult.suggestions.length).toBe(0);
    });

    it("returns error when suggestion id does not exist", async () => {
      const result = await server.callTool("libraxis_promote_suggested_link", {
        id: "nonexistent",
        relation_type: "related_to",
      }) as { error: string };
      expect(result.error).toBeDefined();
      expect(result.error).toContain("nonexistent");
    });
  });
});
