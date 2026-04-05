import type { FastifyInstance } from "fastify";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildHttpServer } from "../../src/api/server.js";
import { registerEntriesRoutes } from "../../src/api/routes/entries-routes.js";
import { registerOwnerEntriesRoutes } from "../../src/api/routes/owner-entries-routes.js";
import { env } from "../../src/config/env.js";
import { createMigratedTestDb, seedUs1Data, type TestDbContext } from "../helpers/test-db.js";

describe("HTTP contract: entry write/update/search/link", () => {
  let ctx: TestDbContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    ctx = createMigratedTestDb();
    seedUs1Data(ctx.db);
    app = await buildHttpServer();
    await registerEntriesRoutes(app, ctx.db);
    await registerOwnerEntriesRoutes(app, ctx.db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    ctx.cleanup();
  });

  async function loginOwnerSession(): Promise<{ cookie: string; csrfToken: string }> {
    const login = await request(app.server).post("/owner/login").send({
      username: env.LIBRAXIS_ADMIN_USERNAME,
      password: env.LIBRAXIS_ADMIN_PASSWORD
    });

    expect(login.status).toBe(200);
    const cookie = login.headers["set-cookie"]?.[0];
    expect(cookie).toBeDefined();
    return {
      cookie: cookie!,
      csrfToken: login.body.csrf_token as string
    };
  }

  it("creates, updates, and searches entries", async () => {
    const createRes = await request(app.server).post("/entries").send({
      type: "note",
      title: "Note A",
      body_markdown: "Collect release notes and summarize key risks.",
      tags: ["release", "quality"]
    });

    expect(createRes.status).toBe(200);
    expect(createRes.body).toHaveProperty("entry_id");
    expect(createRes.body).toHaveProperty("lineage_id");
    expect(createRes.body.version_number).toBe(1);

    const updateRes = await request(app.server)
      .post(`/entries/${createRes.body.lineage_id}/versions`)
      .send({
        expected_version: 1,
        body_markdown: "Collect release notes, summarize risks, and propose mitigation.",
        tags: ["release", "risk"]
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.version_number).toBe(2);

    const searchRes = await request(app.server).get("/entries/search").query({ q: "mitigation" });
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.items.length).toBeGreaterThan(0);
    expect(searchRes.body.items[0]).toHaveProperty("lineage_id", createRes.body.lineage_id);
    expect(searchRes.body.items[0]).toHaveProperty("tags");
    expect(searchRes.body.items[0].tags).toEqual(["release", "risk"]);
  });

  it("preserves existing tags when update omits tags", async () => {
    const created = await request(app.server).post("/entries").send({
      type: "note",
      title: "Carry Tags",
      body_markdown: "version one",
      tags: ["carry", "over"]
    });

    expect(created.status).toBe(200);

    const updated = await request(app.server)
      .post(`/entries/${created.body.lineage_id}/versions`)
      .send({
        expected_version: 1,
        body_markdown: "version two preserved tags"
      });

    expect(updated.status).toBe(200);

    const search = await request(app.server).get("/entries/search").query({ q: "preserved tags" });

    expect(search.status).toBe(200);
    const item = search.body.items.find(
      (result: { lineage_id: string }) => result.lineage_id === created.body.lineage_id
    );
    expect(item).toBeDefined();
    expect(item.tags).toEqual(["carry", "over"]);
  });

  it("returns tags in owner entry history payload", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const created = await request(app.server)
      .post("/owner/entries")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        type: "note",
        title: "Owner Tagged",
        body_markdown: "owner tagged body",
        tags: ["owner", "visible"]
      });

    expect(created.status).toBe(200);

    const detail = await request(app.server)
      .get(`/owner/entries/${created.body.lineage_id}`)
      .set("Cookie", cookie);

    expect(detail.status).toBe(200);
    expect(detail.body.latest.tags).toEqual(["owner", "visible"]);
    expect(detail.body.history[0].tags).toEqual(["owner", "visible"]);
  });

  it("creates links and enforces used_skill direction semantics", async () => {
    const promptRes = await request(app.server).post("/entries").send({
      type: "note",
      title: "Note A",
      body_markdown: "Gather evidence before generating an answer."
    });

    expect(promptRes.status).toBe(200);

    const relatedRes = await request(app.server).post("/links").send({
      source_entry_id: promptRes.body.entry_id,
      target_entry_id: "skill-a-v1",
      relation_type: "related_to"
    });

    expect(relatedRes.status).toBe(200);
    expect(relatedRes.body).toHaveProperty("link_id");

    const invalidDirectionRes = await request(app.server).post("/links").send({
      source_entry_id: promptRes.body.entry_id,
      target_entry_id: "skill-a-v1",
      relation_type: "used_skill"
    });

    expect(invalidDirectionRes.status).toBe(400);
    expect(invalidDirectionRes.body.error).toBe("INVALID_INPUT");
  });

  it("rejects run entry creation on public and owner write paths", async () => {
    const publicCreate = await request(app.server).post("/entries").send({
      type: "run",
      title: "Run should fail",
      body_markdown: "This should be rejected."
    });

    expect(publicCreate.status).toBe(400);
    expect(publicCreate.body.error).toBe("INVALID_INPUT");

    const { cookie, csrfToken } = await loginOwnerSession();

    const ownerCreate = await request(app.server)
      .post("/owner/entries")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        type: "run",
        title: "Owner run should fail",
        body_markdown: "This should also be rejected."
      });

    expect(ownerCreate.status).toBe(400);
    expect(ownerCreate.body.error).toBe("INVALID_INPUT");
  });

  it("blocks direct skill updates in write path", async () => {
    const updateRes = await request(app.server).post("/entries/skill-a/versions").send({
      expected_version: 1,
      body_markdown: "Attempting direct skill update."
    });

    expect(updateRes.status).toBe(400);
    expect(updateRes.body.error).toBe("SKILL_UPDATE_REQUIRES_PROPOSAL");
  });

  it("rejects invalid create and link payloads", async () => {
    const invalidCreate = await request(app.server).post("/entries").send({
      type: "note",
      title: "Missing Body"
    });

    expect(invalidCreate.status).toBe(400);
    expect(invalidCreate.body.error).toBe("INVALID_INPUT");

    const invalidLink = await request(app.server).post("/links").send({
      source_entry_id: "skill-a-v1",
      target_entry_id: "skill-b-v1",
      relation_type: "invalid_relation"
    });

    expect(invalidLink.status).toBe(400);
    expect(invalidLink.body.error).toBe("INVALID_INPUT");
  });

  it("rejects disallowed tag characters", async () => {
    const createRes = await request(app.server).post("/entries").send({
      type: "note",
      title: "Bad Tags",
      body_markdown: "Tag validation should reject invalid names.",
      tags: ["valid_tag", "bad tag!"]
    });

    expect(createRes.status).toBe(400);
    expect(createRes.body.error).toBe("INVALID_INPUT");
  });

  it("updates entry even when prior metadata json is malformed", async () => {
    const created = await request(app.server).post("/entries").send({
      type: "note",
      title: "Corrupt Metadata",
      body_markdown: "v1"
    });

    expect(created.status).toBe(200);

    ctx.db
      .prepare("UPDATE entries SET metadata_json = '{bad' WHERE lineage_id = ? AND is_latest = 1")
      .run(created.body.lineage_id as string);

    const updated = await request(app.server)
      .post(`/entries/${created.body.lineage_id}/versions`)
      .send({
        expected_version: 1,
        body_markdown: "v2"
      });

    expect(updated.status).toBe(200);
    expect(updated.body.version_number).toBe(2);
  });

  it("archives owner entry and excludes it from default search/list", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const created = await request(app.server)
      .post("/owner/entries")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        type: "note",
        title: "Archive Candidate",
        body_markdown: "This entry should be archived and hidden from active lists."
      });

    expect(created.status).toBe(200);
    expect(created.body.lineage_id).toBeDefined();

    const listedBefore = await request(app.server)
      .get("/owner/entries")
      .set("Cookie", cookie)
      .query({ q: "Archive Candidate" });

    expect(listedBefore.status).toBe(200);
    expect(
      listedBefore.body.items.some(
        (item: { lineage_id: string }) => item.lineage_id === created.body.lineage_id
      )
    ).toBe(true);

    const archived = await request(app.server)
      .delete(`/owner/entries/${created.body.lineage_id}`)
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken);

    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe("archived");

    const listedAfter = await request(app.server)
      .get("/owner/entries")
      .set("Cookie", cookie)
      .query({ q: "Archive Candidate" });

    expect(listedAfter.status).toBe(200);
    expect(
      listedAfter.body.items.some(
        (item: { lineage_id: string }) => item.lineage_id === created.body.lineage_id
      )
    ).toBe(false);

    const publicSearch = await request(app.server)
      .get("/entries/search")
      .query({ q: "Archive Candidate" });

    expect(publicSearch.status).toBe(200);
    expect(
      publicSearch.body.items.some(
        (item: { lineage_id: string }) => item.lineage_id === created.body.lineage_id
      )
    ).toBe(false);
  });
});
