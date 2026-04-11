import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildHttpServer } from "../../src/api/server.js";
import { registerOwnerEntriesRoutes } from "../../src/api/routes/owner-entries-routes.js";
import { registerEntriesRoutes } from "../../src/api/routes/entries-routes.js";
import { env } from "../../src/config/env.js";
import { createMigratedTestDb, type TestDbContext } from "../helpers/test-db.js";

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function seedEntry(
  db: Database.Database,
  id: string,
  lineageId: string,
  title = "Entry " + id,
  type = "note"
) {
  db.prepare(
    `INSERT INTO entries(id, lineage_id, type, title, body_markdown, metadata_json, version_number, is_latest, created_by)
     VALUES (?, ?, ?, ?, 'body', '{}', 1, 1, 'test')`
  ).run(id, lineageId, type, title);
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
  tgt: string
) {
  db.prepare(
    `INSERT INTO suggested_links(id, source_entry_id, target_entry_id, signal, score, rationale)
     VALUES (?, ?, ?, 'tag', 0.8, 'test suggestion')`
  ).run(id, src, tgt);
}

// ─── Helper: owner login ──────────────────────────────────────────────────────

async function ownerLogin(app: FastifyInstance): Promise<{ cookie: string; csrfToken: string }> {
  const login = await request(app.server)
    .post("/owner/login")
    .send({ username: env.LIBRAXIS_ADMIN_USERNAME, password: env.LIBRAXIS_ADMIN_PASSWORD });

  const cookie = login.headers["set-cookie"]?.[0] as string;
  const csrfToken = login.body.csrf_token as string;
  return { cookie, csrfToken };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("integration: HTTP related-graph routes (owner)", () => {
  let ctx: TestDbContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    ctx = createMigratedTestDb();

    // Seed two entries with an explicit link
    seedEntry(ctx.db, "entry-a", "lineage-a", "Alpha Entry");
    seedEntry(ctx.db, "entry-b", "lineage-b", "Beta Entry");
    seedLink(ctx.db, "link-ab", "entry-a", "entry-b", "related_to");

    app = await buildHttpServer();
    await registerOwnerEntriesRoutes(app, ctx.db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    ctx.cleanup();
  });

  // 1. GET /owner/entries/:lineageId/graph
  it("GET /owner/entries/:lineageId/graph returns { nodes, edges } shape", async () => {
    const { cookie } = await ownerLogin(app);

    const res = await request(app.server)
      .get("/owner/entries/lineage-a/graph")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.nodes)).toBe(true);
    expect(Array.isArray(res.body.edges)).toBe(true);

    // lineage-b should appear as a node (explicit link)
    const nodeLineageIds = res.body.nodes.map((n: { lineage_id: string }) => n.lineage_id);
    expect(nodeLineageIds).toContain("lineage-b");
  });

  it("GET /owner/entries/:lineageId/graph respects depth=1 query param", async () => {
    const { cookie } = await ownerLogin(app);

    const res = await request(app.server)
      .get("/owner/entries/lineage-a/graph")
      .set("Cookie", cookie)
      .query({ depth: 1, signals: "explicit" });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.nodes)).toBe(true);
  });

  it("GET /owner/entries/:lineageId/graph returns 400 for invalid direction", async () => {
    const { cookie } = await ownerLogin(app);

    const res = await request(app.server)
      .get("/owner/entries/lineage-a/graph")
      .set("Cookie", cookie)
      .query({ direction: "sideways" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
  });

  it("GET /owner/entries/:lineageId/graph returns 400 for invalid relation_types", async () => {
    const { cookie } = await ownerLogin(app);

    const res = await request(app.server)
      .get("/owner/entries/lineage-a/graph")
      .set("Cookie", cookie)
      .query({ relation_types: "depends_on" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
  });

  it("GET /owner/entries/:lineageId/graph returns empty for unknown lineageId", async () => {
    const { cookie } = await ownerLogin(app);

    const res = await request(app.server)
      .get("/owner/entries/nonexistent-lineage/graph")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(0);
    expect(res.body.edges).toHaveLength(0);
  });

  it("GET /owner/entries/:lineageId/graph requires session", async () => {
    const res = await request(app.server).get("/owner/entries/lineage-a/graph");
    expect(res.status).toBe(401);
  });

  // 2. GET /owner/graph
  it("GET /owner/graph returns { nodes, edges } shape", async () => {
    const { cookie } = await ownerLogin(app);

    const res = await request(app.server)
      .get("/owner/graph")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.nodes)).toBe(true);
    expect(Array.isArray(res.body.edges)).toBe(true);
    expect(res.body.nodes.length).toBeGreaterThan(0);
    expect(res.body.edges.length).toBeGreaterThan(0);
    expect(res.body.nodes[0]).toMatchObject({
      lineage_id: expect.any(String),
      entry_id: expect.any(String),
      title: expect.any(String),
      type: expect.any(String),
      depth: expect.any(Number),
      degree: expect.any(Number),
    });
    expect(res.body.edges[0]).toMatchObject({
      source_lineage_id: expect.any(String),
      target_lineage_id: expect.any(String),
      relation_type: expect.any(String),
      signal: "explicit",
      score: expect.any(Number),
    });
  });

  it("GET /owner/graph respects limit query param", async () => {
    const { cookie } = await ownerLogin(app);

    const res = await request(app.server)
      .get("/owner/graph")
      .set("Cookie", cookie)
      .query({ limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.nodes.length).toBeLessThanOrEqual(5);
  });

  it("GET /owner/graph caps limit at 500", async () => {
    const { cookie } = await ownerLogin(app);

    const res = await request(app.server)
      .get("/owner/graph")
      .set("Cookie", cookie)
      .query({ limit: 9999 });

    expect(res.status).toBe(200);
    expect(res.body.nodes.length).toBeLessThanOrEqual(500);
  });

  it("GET /owner/graph requires session", async () => {
    const res = await request(app.server).get("/owner/graph");
    expect(res.status).toBe(401);
  });

  // 3. GET /owner/entries/:lineageId/suggested-links
  it("GET /owner/entries/:lineageId/suggested-links returns { suggestions }", async () => {
    seedSuggestedLink(ctx.db, "sugg-1", "entry-a", "entry-b");
    const { cookie } = await ownerLogin(app);

    const res = await request(app.server)
      .get("/owner/entries/lineage-a/suggested-links")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
    expect(res.body.suggestions[0]).toMatchObject({
      source_entry_id: "entry-a",
      target_entry_id: "entry-b",
      target_lineage_id: "lineage-b",
      target_title: "Beta Entry",
      target_type: "note",
      target_body_preview: "body",
      rationale: "test suggestion",
    });
  });

  it("GET /owner/entries/:lineageId/suggested-links returns empty array for unknown lineage", async () => {
    const { cookie } = await ownerLogin(app);

    const res = await request(app.server)
      .get("/owner/entries/nonexistent/suggested-links")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toHaveLength(0);
  });

  it("GET /owner/entries/:lineageId/suggested-links requires session", async () => {
    const res = await request(app.server).get("/owner/entries/lineage-a/suggested-links");
    expect(res.status).toBe(401);
  });

  // 4. POST /owner/suggested-links/:id/promote
  it("POST /owner/suggested-links/:id/promote returns { link_id }", async () => {
    seedSuggestedLink(ctx.db, "sugg-1", "entry-a", "entry-b");
    const { cookie, csrfToken } = await ownerLogin(app);

    const res = await request(app.server)
      .post("/owner/suggested-links/sugg-1/promote")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({ relation_type: "related_to" });

    expect(res.status).toBe(200);
    expect(typeof res.body.link_id).toBe("string");
    expect(res.body.link_id.length).toBeGreaterThan(0);
  });

  it("POST /owner/suggested-links/:id/promote returns 400 for nonexistent suggestion", async () => {
    const { cookie, csrfToken } = await ownerLogin(app);

    const res = await request(app.server)
      .post("/owner/suggested-links/does-not-exist/promote")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({ relation_type: "related_to" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("POST /owner/suggested-links/:id/promote requires session", async () => {
    const res = await request(app.server)
      .post("/owner/suggested-links/sugg-1/promote")
      .send({ relation_type: "related_to" });
    expect(res.status).toBe(401);
  });
});

// ─── Agent-facing routes ──────────────────────────────────────────────────────

describe("integration: HTTP related-graph routes (agent)", () => {
  let ctx: TestDbContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    ctx = createMigratedTestDb();

    seedEntry(ctx.db, "entry-a", "lineage-a", "Alpha Entry");
    seedEntry(ctx.db, "entry-b", "lineage-b", "Beta Entry");
    seedLink(ctx.db, "link-ab", "entry-a", "entry-b", "related_to");

    app = await buildHttpServer();
    await registerEntriesRoutes(app, ctx.db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    ctx.cleanup();
  });

  // 5. GET /entries/:lineageId/graph
  it("GET /entries/:lineageId/graph returns { nodes, edges } shape", async () => {
    const res = await request(app.server).get("/entries/lineage-a/graph");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.nodes)).toBe(true);
    expect(Array.isArray(res.body.edges)).toBe(true);

    const nodeLineageIds = res.body.nodes.map((n: { lineage_id: string }) => n.lineage_id);
    expect(nodeLineageIds).toContain("lineage-b");
  });

  it("GET /entries/:lineageId/graph accepts signals query param", async () => {
    const res = await request(app.server)
      .get("/entries/lineage-a/graph")
      .query({ signals: "explicit", depth: 1, direction: "out" });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.nodes)).toBe(true);
  });

  it("GET /entries/:lineageId/graph returns 400 for invalid signals", async () => {
    const res = await request(app.server)
      .get("/entries/lineage-a/graph")
      .query({ signals: "explicit,unknown" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
  });

  it("GET /entries/:lineageId/graph returns 400 for invalid direction", async () => {
    const res = await request(app.server)
      .get("/entries/lineage-a/graph")
      .query({ direction: "sideways" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
  });

  it("GET /entries/:lineageId/graph returns 400 for invalid relation_types", async () => {
    const res = await request(app.server)
      .get("/entries/lineage-a/graph")
      .query({ relation_types: "depends_on" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
  });

  it("GET /entries/:lineageId/graph returns empty for unknown lineageId", async () => {
    const res = await request(app.server).get("/entries/nonexistent/graph");

    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(0);
    expect(res.body.edges).toHaveLength(0);
  });

  // 6. GET /entries/:lineageId/suggested-links
  it("GET /entries/:lineageId/suggested-links returns { suggestions }", async () => {
    seedSuggestedLink(ctx.db, "sugg-1", "entry-a", "entry-b");

    const res = await request(app.server).get("/entries/lineage-a/suggested-links");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
    expect(res.body.suggestions[0]).toMatchObject({
      source_entry_id: "entry-a",
      target_entry_id: "entry-b",
      target_lineage_id: "lineage-b",
      target_title: "Beta Entry",
      target_type: "note",
      target_body_preview: "body",
      rationale: "test suggestion",
    });
  });

  it("GET /entries/:lineageId/suggested-links returns empty for unknown lineage", async () => {
    const res = await request(app.server).get("/entries/nonexistent/suggested-links");

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toHaveLength(0);
  });
});
