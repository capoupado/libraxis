import type { FastifyInstance } from "fastify";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildHttpServer } from "../../src/api/server.js";
import { registerOwnerEntriesRoutes } from "../../src/api/routes/owner-entries-routes.js";
import { registerProposalsRoutes } from "../../src/api/routes/proposals-routes.js";
import { env } from "../../src/config/env.js";
import { createMigratedTestDb, seedUs1Data, type TestDbContext } from "../helpers/test-db.js";

describe("timing: proposal review workflow", () => {
  let ctx: TestDbContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    ctx = createMigratedTestDb();
    seedUs1Data(ctx.db);
    app = await buildHttpServer();
    await registerOwnerEntriesRoutes(app, ctx.db);
    await registerProposalsRoutes(app, ctx.db);
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

  it("completes proposal creation and review in under 5 minutes", async () => {
    const start = Date.now();
    const { cookie, csrfToken } = await loginOwnerSession();

    const proposed = await request(app.server)
      .post("/skills/skill-a/proposals")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        proposal_markdown: "Timing validation proposal body.",
        rationale: "SC-004 timing validation"
      });

    expect(proposed.status).toBe(200);

    const reviewed = await request(app.server)
      .post(`/proposals/${proposed.body.proposal_id}/review`)
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({ decision: "approve" });

    expect(reviewed.status).toBe(200);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5 * 60 * 1000);
  });
});
