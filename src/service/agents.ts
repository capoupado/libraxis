import type Database from "better-sqlite3";

import { archiveEntry, createEntry } from "./entries.js";
import { DomainError } from "./errors.js";
import { listSkills, loadSkill, type SkillLoadResult, type SkillListItem } from "./skills.js";

export const AGENT_SKILL_TYPE = "agent";

export interface UploadAgentInput {
  title: string;
  body_markdown: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  created_by: string;
}

export interface ListAgentsInput {
  tags?: string[];
  limit?: number;
}

export interface LoadAgentInput {
  agent_lineage_id?: string;
  agent_entry_id?: string;
}

export interface DeleteAgentInput {
  agent_lineage_id: string;
}

function normalizeAgentMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...(metadata ?? {}) };

  if (
    typeof normalized.skill_type === "string" &&
    normalized.skill_type !== AGENT_SKILL_TYPE
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "Agent upload payload cannot set metadata.skill_type to a non-agent value",
      "Use libraxis_create_entry with type=\"skill\" for non-agent skill creation."
    );
  }

  normalized.skill_type = AGENT_SKILL_TYPE;

  if (!Array.isArray(normalized.steps)) {
    normalized.steps = [];
  }

  return normalized;
}

function assertAgentSkill(metadata: Record<string, unknown>): void {
  if (metadata.skill_type !== AGENT_SKILL_TYPE) {
    throw new DomainError("ENTRY_NOT_FOUND", "Agent entry was not found", "Check agent ID or lineage");
  }
}

export function uploadAgent(db: Database.Database, input: UploadAgentInput) {
  return createEntry(db, {
    type: "skill",
    title: input.title,
    body_markdown: input.body_markdown,
    metadata: normalizeAgentMetadata(input.metadata),
    tags: input.tags,
    created_by: input.created_by
  });
}

export function listAgents(db: Database.Database, input: ListAgentsInput = {}): SkillListItem[] {
  return listSkills(db, {
    tags: input.tags,
    limit: input.limit,
    skill_type: AGENT_SKILL_TYPE
  });
}

export function loadAgent(db: Database.Database, input: LoadAgentInput): SkillLoadResult {
  const result = loadSkill(db, {
    skill_lineage_id: input.agent_lineage_id,
    skill_entry_id: input.agent_entry_id
  });

  assertAgentSkill(result.skill.metadata);
  return result;
}

export function deleteAgent(db: Database.Database, input: DeleteAgentInput) {
  const loaded = loadAgent(db, {
    agent_lineage_id: input.agent_lineage_id
  });

  return archiveEntry(db, loaded.skill.lineage_id);
}
