import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import { proposeSkillImprovement, listProposals, reviewSkillProposal } from "../../service/proposals.js";
import { enforceCsrf, requireOwnerSession } from "../middleware/session-auth.js";
import {
  createProposalSchema,
  parseOrThrow,
  proposalListQuerySchema,
  reviewProposalSchema
} from "../../service/validation/schemas.js";

interface SkillParams {
  lineageId: string;
}

interface ProposalParams {
  proposalId: string;
}

interface ListQuery {
  status?: "pending" | "approved" | "rejected";
}

export async function registerProposalsRoutes(
  app: FastifyInstance,
  db: Database.Database
): Promise<void> {
  app.post<{ Params: SkillParams }>("/skills/:lineageId/proposals", async (request, reply) => {
    const { session } = requireOwnerSession(request, reply, db);
    enforceCsrf(request, session);

    const body = parseOrThrow(createProposalSchema, request.body, "Invalid create-proposal payload");

    return proposeSkillImprovement(db, {
      skill_lineage_id: request.params.lineageId,
      proposal_markdown: body.proposal_markdown,
      rationale: body.rationale,
      proposer: body.proposer ?? session.owner_username,
      action_type: body.action_type ?? "improve"
    });
  });

  app.get<{ Querystring: ListQuery }>("/proposals", async (request, reply) => {
    requireOwnerSession(request, reply, db);
    const query = parseOrThrow(proposalListQuerySchema, request.query, "Invalid proposals query");

    return {
      items: listProposals(db, query.status),
      next_cursor: null
    };
  });

  app.post<{ Params: ProposalParams }>("/proposals/:proposalId/review", async (request, reply) => {
    const { session } = requireOwnerSession(request, reply, db);
    enforceCsrf(request, session);

    const body = parseOrThrow(reviewProposalSchema, request.body, "Invalid review-proposal payload");

    return reviewSkillProposal(db, {
      proposal_id: request.params.proposalId,
      decision: body.decision,
      decision_notes: body.decision_notes,
      decided_by: session.owner_username
    });
  });

  app.get("/skills/dashboard", async (request, reply) => {
    requireOwnerSession(request, reply, db);
    return {
      disabled: true,
      message: "Skill dashboard metrics are temporarily disabled while analytics are redesigned.",
      items: [],
      top_failure_categories: []
    };
  });
}
