import type { FastifyInstance } from "fastify";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildHttpServer } from "../../src/api/server.js";
import { registerSkillsRoutes } from "../../src/api/routes/skills-routes.js";
import { createMigratedTestDb, seedUs1Data, type TestDbContext } from "../helpers/test-db.js";

describe("HTTP contract: context and skills", () => {
  let ctx: TestDbContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    ctx = createMigratedTestDb();
    seedUs1Data(ctx.db);
    app = await buildHttpServer();
    await registerSkillsRoutes(app, ctx.db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    ctx.cleanup();
  });

  it("GET /context returns ranked result entries with required metadata fields", async () => {
    const res = await request(app.server).get("/context").query({ task: "validate workflow context" });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBeGreaterThan(0);

    const first = res.body.results[0];
    expect(first).toHaveProperty("entry_id");
    expect(first).toHaveProperty("lineage_id");
    expect(first).toHaveProperty("type");
    expect(first).toHaveProperty("title");
    expect(first).toHaveProperty("tags");
    expect(first).toHaveProperty("created_at");
    expect(first).toHaveProperty("score");
    expect(first).toHaveProperty("snippet");

    const skillResult = res.body.results.find((item: { type: string }) => item.type === "skill");
    expect(skillResult).toBeDefined();
    expect(skillResult).toHaveProperty("skill_type");
    expect(skillResult).toHaveProperty("latest_version");
  });

  it("GET /skills returns discoverable skills with tags and metadata", async () => {
    const res = await request(app.server).get("/skills").query({ tags: "automation" });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      lineage_id: "skill-a",
      skill_type: "workflow"
    });
  });

  it("GET /skills/:lineageId/load resolves one-level sub-skills and linked entries", async () => {
    const res = await request(app.server).get("/skills/skill-a/load");

    expect(res.status).toBe(200);
    expect(res.body.skill.lineage_id).toBe("skill-a");
    expect(Array.isArray(res.body.resolved_sub_skills)).toBe(true);
    expect(res.body.resolved_sub_skills.length).toBe(1);
    expect(res.body.resolved_sub_skills[0].lineage_id).toBe("skill-b");
    expect(res.body.related_mistakes.length).toBe(1);
    expect(res.body.related_lessons.length).toBe(1);
  });
});
