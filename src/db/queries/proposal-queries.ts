import type Database from "better-sqlite3";

import { ulid } from "ulid";

export type ProposalStatus = "pending" | "approved" | "rejected";
export type ProposalActionType = "improve" | "archive";

export interface SkillProposalRow {
  id: string;
  skill_lineage_id: string;
  proposer: string;
  proposal_markdown: string;
  rationale: string;
  action_type: ProposalActionType;
  status: ProposalStatus;
  skill_title: string | null;
  decision_notes: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface CreateProposalInput {
  skillLineageId: string;
  proposer: string;
  proposalMarkdown: string;
  rationale: string;
  actionType?: ProposalActionType;
}

export function createSkillProposal(db: Database.Database, input: CreateProposalInput): string {
  const proposalId = ulid();
  db.prepare(
    `
      INSERT INTO skill_proposals(
        id, skill_lineage_id, proposer, proposal_markdown, rationale, action_type, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `
  ).run(
    proposalId,
    input.skillLineageId,
    input.proposer,
    input.proposalMarkdown,
    input.rationale,
    input.actionType ?? "improve"
  );
  return proposalId;
}

export function listSkillProposals(
  db: Database.Database,
  status?: ProposalStatus
): SkillProposalRow[] {
  const baseSelect = `
    SELECT
      sp.id,
      sp.skill_lineage_id,
      sp.proposer,
      sp.proposal_markdown,
      sp.rationale,
      CASE lower(trim(coalesce(sp.action_type, 'improve')))
        WHEN 'archive' THEN 'archive'
        ELSE 'improve'
      END AS action_type,
      CASE lower(trim(sp.status))
        WHEN 'approved' THEN 'approved'
        WHEN 'rejected' THEN 'rejected'
        ELSE 'pending'
      END AS status,
      e.title AS skill_title,
      sp.decision_notes,
      sp.decided_by,
      sp.decided_at,
      sp.created_at
    FROM skill_proposals sp
    LEFT JOIN entries e
      ON e.lineage_id = sp.skill_lineage_id
      AND e.type = 'skill'
      AND e.is_latest = 1
  `;

  if (status) {
    return db
      .prepare<string, SkillProposalRow>(
        `${baseSelect}
        WHERE lower(trim(sp.status)) = lower(trim(?))
        ORDER BY sp.created_at DESC`
      )
      .all(status);
  }

  return db
    .prepare<[], SkillProposalRow>(`${baseSelect} ORDER BY sp.created_at DESC`)
    .all();
}

export function getSkillProposalById(
  db: Database.Database,
  proposalId: string
): SkillProposalRow | undefined {
  return db
    .prepare<string, SkillProposalRow>(
      `
        SELECT
          sp.id,
          sp.skill_lineage_id,
          sp.proposer,
          sp.proposal_markdown,
          sp.rationale,
          CASE lower(trim(coalesce(sp.action_type, 'improve')))
            WHEN 'archive' THEN 'archive'
            ELSE 'improve'
          END AS action_type,
          CASE lower(trim(sp.status))
            WHEN 'approved' THEN 'approved'
            WHEN 'rejected' THEN 'rejected'
            ELSE 'pending'
          END AS status,
          e.title AS skill_title,
          sp.decision_notes,
          sp.decided_by,
          sp.decided_at,
          sp.created_at
        FROM skill_proposals sp
        LEFT JOIN entries e
          ON e.lineage_id = sp.skill_lineage_id
          AND e.type = 'skill'
          AND e.is_latest = 1
        WHERE sp.id = ?
      `
    )
    .get(proposalId);
}

export function updateSkillProposalStatus(
  db: Database.Database,
  proposalId: string,
  status: Exclude<ProposalStatus, "pending">,
  decidedBy: string,
  decisionNotes?: string,
  expectedCurrentStatus: ProposalStatus = "pending"
): boolean {
  const result = db.prepare(
    `
      UPDATE skill_proposals
      SET status = ?,
          decided_by = ?,
          decision_notes = ?,
          decided_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
        AND lower(trim(status)) = lower(trim(?))
    `
  ).run(status, decidedBy, decisionNotes ?? null, proposalId, expectedCurrentStatus);

  return result.changes > 0;
}
