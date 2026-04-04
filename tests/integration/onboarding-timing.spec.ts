import type { FastifyInstance } from "fastify";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildHttpServer } from "../../src/api/server.js";
import { registerAdminRoutes } from "../../src/api/routes/admin-routes.js";
import { registerOwnerEntriesRoutes } from "../../src/api/routes/owner-entries-routes.js";
import { env } from "../../src/config/env.js";
import { createMigratedTestDb, type TestDbContext } from "../helpers/test-db.js";

describe("timing: onboarding", () => {
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

  it("creates an API key and completes first authenticated call under 10 minutes", async () => {
    const start = Date.now();
    const { cookie, csrfToken } = await loginOwnerSession();

    const created = await request(app.server)
      .post("/admin/api-keys")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        name: "onboarding-client",
        scopes: ["read", "write"]
      });
    expect(created.status).toBe(200);

    const firstCall = await request(app.server)
      .post("/admin/entries")
      .set("x-api-key", created.body.plaintext_key as string)
      .send({
        type: "note",
        title: "Onboarding note",
        body_markdown: "First authenticated call after API key creation."
      });
    expect(firstCall.status).toBe(200);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10 * 60 * 1000);
  });
});
