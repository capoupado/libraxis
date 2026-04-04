import type { FastifyInstance } from "fastify";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildHttpServer } from "../../src/api/server.js";
import { registerAgentsRoutes } from "../../src/api/routes/agents-routes.js";
import { registerOwnerEntriesRoutes } from "../../src/api/routes/owner-entries-routes.js";
import { env } from "../../src/config/env.js";
import { createMigratedTestDb, type TestDbContext } from "../helpers/test-db.js";

describe("HTTP contract: agents", () => {
  let ctx: TestDbContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    ctx = createMigratedTestDb();
    app = await buildHttpServer();
    await registerOwnerEntriesRoutes(app, ctx.db);
    await registerAgentsRoutes(app, ctx.db);
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

  it("creates, lists, and loads agent entries", async () => {
    const unauthorized = await request(app.server).post("/owner/agents").send({
      title: "Blocked",
      body_markdown: "Should fail without owner session."
    });
    expect(unauthorized.status).toBe(401);

    const { cookie, csrfToken } = await loginOwnerSession();

    const created = await request(app.server)
      .post("/owner/agents")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        title: "Agent Alpha",
        body_markdown: "Reusable instructions for portable execution.",
        tags: ["agent", "portable"],
        metadata: {
          runtime: "mcp"
        }
      });

    expect(created.status).toBe(200);
    expect(created.body.lineage_id).toBeDefined();

    const listed = await request(app.server).get("/agents");
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.items)).toBe(true);
    expect(listed.body.items.some((item: { lineage_id: string; skill_type: string }) => item.lineage_id === created.body.lineage_id && item.skill_type === "agent")).toBe(true);

    const loaded = await request(app.server).get(`/agents/${created.body.lineage_id}/load`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.skill.lineage_id).toBe(created.body.lineage_id);
    expect(loaded.body.skill.metadata.skill_type).toBe("agent");
    expect(loaded.body.skill.body_markdown).toContain("Reusable instructions");
  });

  it("archives agents via owner endpoint and removes them from agent listing", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const created = await request(app.server)
      .post("/owner/agents")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        title: "Agent To Archive",
        body_markdown: "Temporary agent.",
        tags: ["agent"],
        metadata: {
          runtime: "mcp"
        }
      });

    expect(created.status).toBe(200);

    const archived = await request(app.server)
      .delete(`/owner/agents/${created.body.lineage_id}`)
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken);

    expect(archived.status).toBe(200);
    expect(archived.body.lineage_id).toBe(created.body.lineage_id);
    expect(archived.body.status).toBe("archived");

    const listed = await request(app.server).get("/agents");
    expect(listed.status).toBe(200);
    expect(
      listed.body.items.some(
        (item: { lineage_id: string }) => item.lineage_id === created.body.lineage_id
      )
    ).toBe(false);

    const loaded = await request(app.server).get(`/agents/${created.body.lineage_id}/load`);
    expect(loaded.status).toBe(404);
  });

  it("rejects invalid owner agent payloads", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const invalid = await request(app.server)
      .post("/owner/agents")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        title: "",
        body_markdown: "valid body"
      });

    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("INVALID_INPUT");
  });

  it("rejects owner agent payloads with non-agent skill_type metadata", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const invalid = await request(app.server)
      .post("/owner/agents")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        title: "Actually a skill",
        body_markdown: "This should be created through the skill path.",
        metadata: {
          skill_type: "workflow"
        }
      });

    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("INVALID_INPUT");
    expect(invalid.body.suggestion).toContain("libraxis_create_entry");
  });

  it("lists agents even when many newer non-agent skills exceed default limit", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const agent = await request(app.server)
      .post("/owner/agents")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        title: "Older Agent",
        body_markdown: "Agent body.",
        metadata: {
          runtime: "mcp"
        }
      });

    expect(agent.status).toBe(200);

    const insertSkill = ctx.db.prepare(
      `
        INSERT INTO entries(
          id, lineage_id, type, title, body_markdown, metadata_json, version_number, is_latest, created_by
        ) VALUES (?, ?, 'skill', ?, ?, ?, 1, 1, 'seed')
      `
    );

    for (let i = 0; i < 25; i += 1) {
      insertSkill.run(
        `instruction-${i}`,
        `instruction-${i}`,
        `Instruction Skill ${i}`,
        "Instruction content",
        JSON.stringify({ skill_type: "instructions", steps: [] })
      );
    }

    const listed = await request(app.server).get("/agents").query({ limit: 20 });
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.items)).toBe(true);
    expect(
      listed.body.items.some(
        (item: { lineage_id: string; skill_type: string }) =>
          item.lineage_id === agent.body.lineage_id && item.skill_type === "agent"
      )
    ).toBe(true);
  });
});
