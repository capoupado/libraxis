import type { FastifyInstance } from "fastify";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildHttpServer } from "../../src/api/server.js";
import { registerAdminRoutes } from "../../src/api/routes/admin-routes.js";
import { registerOwnerEntriesRoutes } from "../../src/api/routes/owner-entries-routes.js";
import { env } from "../../src/config/env.js";
import { createMigratedTestDb, type TestDbContext } from "../helpers/test-db.js";

describe("integration: auth export flow", () => {
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

  it("enforces key scopes, rejects revoked keys, and keeps export frontmatter valid", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const readKey = await request(app.server)
      .post("/admin/api-keys")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        name: "read-client",
        scopes: ["read"]
      });

    const writeKey = await request(app.server)
      .post("/admin/api-keys")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        name: "write-client",
        scopes: ["read", "write"]
      });

    const readToken = readKey.body.plaintext_key as string;
    const writeToken = writeKey.body.plaintext_key as string;

    const created = await request(app.server)
      .post("/admin/entries")
      .set("x-api-key", writeToken)
      .send({
        type: "note",
        title: "Scoped Entry",
        body_markdown: "Entry content for export validity check."
      });

    expect(created.status).toBe(200);

    const deniedWrite = await request(app.server)
      .post("/admin/entries")
      .set("x-api-key", readToken)
      .send({
        type: "note",
        title: "Denied",
        body_markdown: "Should not write."
      });
    expect(deniedWrite.status).toBe(403);

    const allowedExport = await request(app.server)
      .get(`/admin/entries/${created.body.lineage_id}/export`)
      .set("x-api-key", readToken);
    expect(allowedExport.status).toBe(200);
    expect(allowedExport.body.markdown).toContain("---");
    expect(allowedExport.body.markdown).toContain("version_number:");

    const revoked = await request(app.server)
      .post(`/admin/api-keys/${readKey.body.key_id}/revoke`)
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken);
    expect(revoked.status).toBe(200);

    const deniedAfterRevoke = await request(app.server)
      .get(`/admin/entries/${created.body.lineage_id}/export`)
      .set("x-api-key", readToken);
    expect(deniedAfterRevoke.status).toBe(401);
  });

  it("denies concurrent exports after key revocation", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const readKey = await request(app.server)
      .post("/admin/api-keys")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        name: "concurrent-read-client",
        scopes: ["read"]
      });

    const writeKey = await request(app.server)
      .post("/admin/api-keys")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        name: "concurrent-write-client",
        scopes: ["read", "write"]
      });

    const readToken = readKey.body.plaintext_key as string;
    const writeToken = writeKey.body.plaintext_key as string;

    const created = await request(app.server)
      .post("/admin/entries")
      .set("x-api-key", writeToken)
      .send({
        type: "note",
        title: "Concurrent Revocation",
        body_markdown: "Entry content for concurrent revocation checks."
      });

    expect(created.status).toBe(200);

    const revoked = await request(app.server)
      .post(`/admin/api-keys/${readKey.body.key_id}/revoke`)
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken);

    expect(revoked.status).toBe(200);

    const responses = await Promise.all([
      request(app.server)
        .get(`/admin/entries/${created.body.lineage_id}/export`)
        .set("x-api-key", readToken),
      request(app.server)
        .get(`/admin/entries/${created.body.lineage_id}/export`)
        .set("x-api-key", readToken),
      request(app.server)
        .get(`/admin/entries/${created.body.lineage_id}/export`)
        .set("x-api-key", readToken)
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("AUTH_REQUIRED");
    }
  });
});
