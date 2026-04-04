import type Database from "better-sqlite3";
import { z } from "zod";

import type { BaseMcpServer } from "../server.js";
import { reviewSkillProposal, listProposals, proposeSkillImprovement } from "../../service/proposals.js";
import { buildSkillMetrics } from "../../service/skill-metrics.js";

const proposeSchema = z.object({
  skill_lineage_id: z.string().min(1),
  proposal_markdown: z.string().min(1),
  rationale: z.string().min(1),
  action_type: z.enum(["improve", "archive"]).default("improve"),
  proposer: z.string().min(1).default("agent")
});

const listSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional()
});

const reviewSchema = z.object({
  proposal_id: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  decision_notes: z.string().optional(),
  decided_by: z.string().min(1).default("owner")
});

export function registerProposalTools(server: BaseMcpServer, db: Database.Database): void {
  server.registerTool("libraxis_propose_skill_improvement", async (input) => {
    const parsed = proposeSchema.parse(input);
    return proposeSkillImprovement(db, parsed);
  });

  server.registerTool("libraxis_list_skill_proposals", async (input) => {
    const parsed = listSchema.parse(input ?? {});
    return {
      items: listProposals(db, parsed.status),
      next_cursor: null
    };
  });

  server.registerTool("libraxis_review_skill_proposal", async (input) => {
    const parsed = reviewSchema.parse(input);
    return reviewSkillProposal(db, parsed);
  });

  server.registerTool("libraxis_skill_dashboard", async () => {
    return buildSkillMetrics(db);
  });
}
