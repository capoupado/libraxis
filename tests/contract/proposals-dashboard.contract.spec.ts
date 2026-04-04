import type { FastifyInstance } from "fastify";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildHttpServer } from "../../src/api/server.js";
import { registerOwnerEntriesRoutes } from "../../src/api/routes/owner-entries-routes.js";
import { registerProposalsRoutes } from "../../src/api/routes/proposals-routes.js";
import { env } from "../../src/config/env.js";
import { createMigratedTestDb, seedUs1Data, type TestDbContext } from "../helpers/test-db.js";

describe("HTTP contract: proposals lifecycle and dashboard metrics", () => {
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

  it("requires owner session and csrf token for proposal create/review", async () => {
    const unauthenticatedList = await request(app.server).get("/proposals").query({ status: "pending" });
    expect(unauthenticatedList.status).toBe(401);

    const { cookie, csrfToken } = await loginOwnerSession();

    const missingCsrfCreate = await request(app.server)
      .post("/skills/skill-a/proposals")
      .set("Cookie", cookie)
      .send({
        proposal_markdown: "Missing CSRF",
        rationale: "csrf should be required"
      });

    expect(missingCsrfCreate.status).toBe(403);

    const created = await request(app.server)
      .post("/skills/skill-a/proposals")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        proposal_markdown: "Review csrf check",
        rationale: "csrf should be required for review"
      });

    expect(created.status).toBe(200);

    const missingCsrfReview = await request(app.server)
      .post(`/proposals/${created.body.proposal_id}/review`)
      .set("Cookie", cookie)
      .send({ decision: "approve" });

    expect(missingCsrfReview.status).toBe(403);
  });

  it("supports proposal create/list/review and creates new skill version on approve", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const create = await request(app.server)
      .post("/skills/skill-a/proposals")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        proposal_markdown: "Updated Skill A proposal body.",
        rationale: "Improve guardrail ordering.",
        proposer: "agent-1"
      });

    expect(create.status).toBe(200);
    expect(create.body.status).toBe("pending");
    expect(create.body.action_type).toBe("improve");

    const proposalId = create.body.proposal_id as string;

    const list = await request(app.server)
      .get("/proposals")
      .set("Cookie", cookie)
      .query({ status: "pending" });

    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    const listedProposal = list.body.items.find((item: { id: string }) => item.id === proposalId) as
      | {
          id: string;
          skill_title: string | null;
        }
      | undefined;
    expect(listedProposal?.skill_title).toBe("Skill A");
    const review = await request(app.server)
      .post(`/proposals/${proposalId}/review`)
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        decision: "approve"
      });

    expect(review.status).toBe(200);
    expect(review.body.proposal_status).toBe("approved");
    expect(review.body.action_type).toBe("improve");
    expect(review.body.new_skill_entry_id).toBeDefined();

    const reviewedBy = ctx.db
      .prepare<[string], { decided_by: string | null }>("SELECT decided_by FROM skill_proposals WHERE id = ?")
      .get(proposalId);

    expect(reviewedBy?.decided_by).toBe(env.LIBRAXIS_ADMIN_USERNAME);
  });

  it("rejects client-supplied decided_by in review payload", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const create = await request(app.server)
      .post("/skills/skill-a/proposals")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        proposal_markdown: "Review payload validation",
        rationale: "Ensure spoofing is blocked"
      });

    expect(create.status).toBe(200);

    const review = await request(app.server)
      .post(`/proposals/${create.body.proposal_id}/review`)
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({ decision: "approve", decided_by: "spoofed-user" });

    expect(review.status).toBe(400);
    expect(review.body.error).toBe("INVALID_INPUT");
  });

  it("supports archive proposals and archives skill lineage on approve", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    const create = await request(app.server)
      .post("/skills/skill-a/proposals")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        proposal_markdown: "Archive this skill due to deprecation.",
        rationale: "Replaced by new workflow.",
        proposer: "agent-2",
        action_type: "archive"
      });

    expect(create.status).toBe(200);
    expect(create.body.status).toBe("pending");
    expect(create.body.action_type).toBe("archive");

    const pending = await request(app.server)
      .get("/proposals")
      .set("Cookie", cookie)
      .query({ status: "pending" });

    expect(pending.status).toBe(200);
    expect(
      pending.body.items.some(
        (item: { id: string; action_type: string }) =>
          item.id === create.body.proposal_id && item.action_type === "archive"
      )
    ).toBe(true);

    const review = await request(app.server)
      .post(`/proposals/${create.body.proposal_id}/review`)
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({
        decision: "approve"
      });

    expect(review.status).toBe(200);
    expect(review.body.proposal_status).toBe("approved");
    expect(review.body.action_type).toBe("archive");
    expect(review.body.archived_lineage_id).toBe("skill-a");

    const archivedRows = ctx.db
      .prepare<[string], { status: string }>(
        "SELECT DISTINCT status FROM entries WHERE lineage_id = ?"
      )
      .all("skill-a");

    expect(archivedRows).toHaveLength(1);
    expect(archivedRows[0]?.status).toBe("archived");
  });

  it("treats legacy pending-removal improve proposals as archive intent", async () => {
    const { cookie, csrfToken } = await loginOwnerSession();

    ctx.db
      .prepare(
        `
          INSERT INTO skill_proposals(
            id, skill_lineage_id, proposer, proposal_markdown, rationale, action_type, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        "proposal-legacy-archive",
        "skill-a",
        "legacy-agent",
        "Pending removal due to deprecation.",
        "Legacy archive format",
        "improve",
        "pending"
      );

    const review = await request(app.server)
      .post("/proposals/proposal-legacy-archive/review")
      .set("Cookie", cookie)
      .set("x-csrf-token", csrfToken)
      .send({ decision: "approve" });

    expect(review.status).toBe(200);
    expect(review.body.proposal_status).toBe("approved");
    expect(review.body.action_type).toBe("archive");
    expect(review.body.archived_lineage_id).toBe("skill-a");

    const archivedRows = ctx.db
      .prepare<[string], { status: string }>(
        "SELECT DISTINCT status FROM entries WHERE lineage_id = ?"
      )
      .all("skill-a");

    expect(archivedRows).toHaveLength(1);
    expect(archivedRows[0]?.status).toBe("archived");
  });

  it("returns an explicit disabled payload for the skill dashboard", async () => {
    const { cookie } = await loginOwnerSession();

    const dashboard = await request(app.server).get("/skills/dashboard").set("Cookie", cookie);

    expect(dashboard.status).toBe(200);
    expect(dashboard.body.disabled).toBe(true);
    expect(dashboard.body.message).toContain("temporarily disabled");
    expect(Array.isArray(dashboard.body.items)).toBe(true);
    expect(dashboard.body.items).toHaveLength(0);
    expect(Array.isArray(dashboard.body.top_failure_categories)).toBe(true);
    expect(dashboard.body.top_failure_categories).toHaveLength(0);
  });
});
