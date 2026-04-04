import type Database from "better-sqlite3";
import { ulid } from "ulid";

import {
  createSkillProposal,
  getSkillProposalById,
  listSkillProposals as listSkillProposalRows,
  updateSkillProposalStatus
} from "../db/queries/proposal-queries.js";
import {
  archiveEntryLineage,
  createEntry as createEntryRow,
  getLatestEntryByLineage,
  markPreviousVersionsNotLatest
} from "../db/queries/entry-queries.js";
import { DomainError } from "./errors.js";

function resolveProposalActionType(
  actionType: string | null | undefined,
  proposalMarkdown: string
): "improve" | "archive" {
  const normalized = actionType?.trim().toLowerCase();
  if (normalized === "archive") {
    return "archive";
  }

  // Support legacy archive intent that was represented as markdown text.
  if (/^\s*pending\s+removal\b/i.test(proposalMarkdown)) {
    return "archive";
  }

  return "improve";
}

export function proposeSkillImprovement(
  db: Database.Database,
  input: {
    skill_lineage_id: string;
    proposal_markdown: string;
    rationale: string;
    proposer: string;
    action_type?: "improve" | "archive";
  }
) {
  const skill = getLatestEntryByLineage(db, input.skill_lineage_id);
  if (!skill || skill.type !== "skill") {
    throw new DomainError("ENTRY_NOT_FOUND", "Skill lineage not found for proposal");
  }

  if (skill.status === "archived") {
    throw new DomainError(
      "FORBIDDEN",
      "Archived skills cannot receive proposals",
      "Use an active skill lineage."
    );
  }

  const proposalId = createSkillProposal(db, {
    skillLineageId: input.skill_lineage_id,
    proposer: input.proposer,
    proposalMarkdown: input.proposal_markdown,
    rationale: input.rationale,
    actionType: input.action_type ?? "improve"
  });

  return {
    proposal_id: proposalId,
    status: "pending" as const,
    action_type: input.action_type ?? "improve"
  };
}

export function listProposals(db: Database.Database, status?: "pending" | "approved" | "rejected") {
  return listSkillProposalRows(db, status);
}

export function reviewSkillProposal(
  db: Database.Database,
  input: {
    proposal_id: string;
    decision: "approve" | "reject";
    decision_notes?: string;
    decided_by: string;
  }
) {
  const proposal = getSkillProposalById(db, input.proposal_id);
  if (!proposal) {
    throw new DomainError("PROPOSAL_NOT_FOUND", "Proposal not found");
  }

  if (proposal.status !== "pending") {
    throw new DomainError("PROPOSAL_STATE_INVALID", "Only pending proposals can be reviewed");
  }

  const actionType = resolveProposalActionType(proposal.action_type, proposal.proposal_markdown);

  if (input.decision === "reject") {
    const changed = updateSkillProposalStatus(
      db,
      proposal.id,
      "rejected",
      input.decided_by,
      input.decision_notes
    );

    if (!changed) {
      throw new DomainError(
        "PROPOSAL_STATE_INVALID",
        "Proposal is no longer pending",
        "Reload proposals and retry the review action."
      );
    }

    return {
      proposal_status: "rejected" as const,
      action_type: actionType
    };
  }

  const latestSkill = getLatestEntryByLineage(db, proposal.skill_lineage_id);
  if (!latestSkill || latestSkill.type !== "skill") {
    throw new DomainError("ENTRY_NOT_FOUND", "Skill lineage no longer exists");
  }

  if (actionType === "archive") {
    const applyArchive = db.transaction(() => {
      const changed = updateSkillProposalStatus(
        db,
        proposal.id,
        "approved",
        input.decided_by,
        input.decision_notes
      );
      if (!changed) {
        throw new DomainError(
          "PROPOSAL_STATE_INVALID",
          "Proposal is no longer pending",
          "Reload proposals and retry the review action."
        );
      }

      archiveEntryLineage(db, proposal.skill_lineage_id);
    });

    applyArchive();

    return {
      proposal_status: "approved" as const,
      action_type: "archive" as const,
      archived_lineage_id: proposal.skill_lineage_id
    };
  }

  if (latestSkill.status === "archived") {
    throw new DomainError(
      "PROPOSAL_STATE_INVALID",
      "Archived skills cannot accept improvement approvals"
    );
  }

  const apply = db.transaction(() => {
    const changed = updateSkillProposalStatus(
      db,
      proposal.id,
      "approved",
      input.decided_by,
      input.decision_notes
    );
    if (!changed) {
      throw new DomainError(
        "PROPOSAL_STATE_INVALID",
        "Proposal is no longer pending",
        "Reload proposals and retry the review action."
      );
    }

    markPreviousVersionsNotLatest(db, latestSkill.lineage_id);

    const newSkillId = ulid();
    createEntryRow(db, {
      id: newSkillId,
      lineageId: latestSkill.lineage_id,
      type: "skill",
      title: latestSkill.title,
      bodyMarkdown: proposal.proposal_markdown,
      metadataJson: latestSkill.metadata_json,
      parentId: latestSkill.id,
      versionNumber: latestSkill.version_number + 1,
      createdBy: input.decided_by
    });

    return newSkillId;
  });

  const newSkillId = apply();

  return {
    proposal_status: "approved" as const,
    action_type: "improve" as const,
    new_skill_entry_id: newSkillId
  };
}
