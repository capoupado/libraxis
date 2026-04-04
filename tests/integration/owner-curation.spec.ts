import type { FastifyInstance } from "fastify";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildHttpServer } from "../../src/api/server.js";
import { registerOwnerEntriesRoutes } from "../../src/api/routes/owner-entries-routes.js";
import { env } from "../../src/config/env.js";
import { createMigratedTestDb, seedUs1Data, type TestDbContext } from "../helpers/test-db.js";

describe("integration: owner curation workflows", () => {
  let ctx: TestDbContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    ctx = createMigratedTestDb();
    seedUs1Data(ctx.db);
    app = await buildHttpServer();
    await registerOwnerEntriesRoutes(app, ctx.db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    ctx.cleanup();
  });

  it("rejects invalid owner login payload", async () => {
    const login = await request(app.server).post("/owner/login").send({ username: "", password: "" });

    expect(login.status).toBe(400);
    expect(login.body.error).toBe("INVALID_INPUT");
  });

  it("supports owner login, browse, detail, and edit version history", async () => {
    const login = await request(app.server).post("/owner/login").send({
      username: env.LIBRAXIS_ADMIN_USERNAME,
      password: env.LIBRAXIS_ADMIN_PASSWORD
    });

    expect(login.status).toBe(200);
    const cookie = login.headers["set-cookie"]?.[0];
    expect(cookie).toBeDefined();
    const csrfToken = login.body.csrf_token as string;
    expect(typeof csrfToken).toBe("string");

    const list = await request(app.server)
      .get("/owner/entries")
      .set("Cookie", cookie!)
      .query({ q: "Skill" });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(list.body.items.length).toBeGreaterThan(0);

    const targetLineage = list.body.items[0].lineage_id as string;

    const detail = await request(app.server)
      .get(`/owner/entries/${targetLineage}`)
      .set("Cookie", cookie!);
    expect(detail.status).toBe(200);
    expect(Array.isArray(detail.body.history)).toBe(true);
    expect(detail.body.history.length).toBeGreaterThan(0);

    const latest = detail.body.latest as { version_number: number };
    const edit = await request(app.server)
      .post(`/owner/entries/${targetLineage}/edit`)
      .set("Cookie", cookie!)
      .set("x-csrf-token", csrfToken)
      .send({
        expected_version: latest.version_number,
        body_markdown: "Owner updated body for curated entry."
      });

    expect(edit.status).toBe(200);
    expect(edit.body.version_number).toBe(latest.version_number + 1);

    const afterEdit = await request(app.server)
      .get(`/owner/entries/${targetLineage}`)
      .set("Cookie", cookie!);
    expect(afterEdit.status).toBe(200);
    expect(afterEdit.body.history.length).toBeGreaterThanOrEqual(2);
  });
});
