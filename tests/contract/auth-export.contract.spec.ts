import type { FastifyInstance } from "fastify";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildHttpServer } from "../../src/api/server.js";
import { registerAdminRoutes } from "../../src/api/routes/admin-routes.js";
import { registerOwnerEntriesRoutes } from "../../src/api/routes/owner-entries-routes.js";
import { env } from "../../src/config/env.js";
import { createMigratedTestDb, type TestDbContext } from "../helpers/test-db.js";

describe("HTTP contract: auth and export", () => {
  let ctx: TestDbContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    ctx = createMigratedTestDb();
    app = await buildHttpServer();
    await registerOwnerEntriesRoutes(app, ctx.db);
    await registerAdminRoutes(app, ctx.db);
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

  it("sets secure owner session cookie attributes on login", async () => {
    const login = await request(app.server).post("/owner/login").send({
      username: env.LIBRAXIS_ADMIN_USERNAME,
      password: env.LIBRAXIS_ADMIN_PASSWORD
    });

    expect(login.status).toBe(200);
    const cookie = login.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    if (env.LIBRAXIS_COOKIE_SECURE) {
      expect(cookie).toContain("Secure");
    } else {
      expect(cookie).not.toContain("Secure");
    }
  });

  it("returns current owner session details for cookie-authenticated requests", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const session = await request(app.server).get("/owner/session").set("Cookie", cookie);

    expect(session.status).toBe(200);
    expect(session.body.csrf_token).toBe(csrfToken);
    expect(session.body.owner_username).toBe(env.LIBRAXIS_ADMIN_USERNAME);
    expect(typeof session.body.expires_at).toBe("string");
  });

  it("rejects owner session bootstrap when cookie is missing", async () => {
    const session = await request(app.server).get("/owner/session");

    expect(session.status).toBe(401);
    expect(session.body.error).toBe("AUTH_REQUIRED");
  });

  it("rejects invalid admin API key payloads", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const created = await request(app.server)
      .post("/admin/api-keys")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        name: "invalid-scopes",
        scopes: "read"
      });

    expect(created.status).toBe(400);
    expect(created.body.error).toBe("INVALID_INPUT");
  });

  it("supports API key create/list/revoke lifecycle", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const created = await request(app.server)
      .post("/admin/api-keys")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        name: "contract-key",
        scopes: ["read", "write", "admin"]
      });

    expect(created.status).toBe(200);
    expect(created.body.key_id).toBeDefined();
    expect(created.body.plaintext_key).toBeDefined();

    const listed = await request(app.server).get("/admin/api-keys").set("Cookie", cookie);
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.keys)).toBe(true);
    expect(listed.body.keys.some((key: { id: string }) => key.id === created.body.key_id)).toBe(true);

    const revoked = await request(app.server)
      .post(`/admin/api-keys/${created.body.key_id}/revoke`)
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken);
    expect(revoked.status).toBe(200);
    expect(revoked.body.revoked).toBe(true);
  });

  it("exports entry markdown with YAML frontmatter metadata", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const key = await request(app.server)
      .post("/admin/api-keys")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        name: "export-key",
        scopes: ["read", "write"]
      });

    const plaintext = key.body.plaintext_key as string;

    const createdEntry = await request(app.server)
      .post("/admin/entries")
      .set("x-api-key", plaintext)
      .send({
        type: "note",
        title: "Export Me",
        body_markdown: "Portable markdown body."
      });

    expect(createdEntry.status).toBe(200);

    const exported = await request(app.server)
      .get(`/admin/entries/${createdEntry.body.lineage_id}/export`)
      .set("x-api-key", plaintext);

    expect(exported.status).toBe(200);
    expect(exported.body.filename).toMatch(/\.md$/);
    expect(exported.body.markdown).toContain("---");
    expect(exported.body.markdown).toContain("lineage_id:");
    expect(exported.body.markdown).toContain("title:");
  });
});
