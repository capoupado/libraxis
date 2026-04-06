import type Database from "better-sqlite3";

import { listTagsForEntry } from "../db/queries/tag-queries.js";
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
  const limit = input.limit ?? 20;

  // Get skill-type agents (uploaded via the agent form)
  const skillAgents = listSkills(db, {
    tags: input.tags,
    skill_type: AGENT_SKILL_TYPE,
    limit
  });

  // Also get any entries tagged "agent" (regardless of entry type)
  const taggedRows = db
    .prepare<
      [],
      { id: string; lineage_id: string; title: string; type: string; created_at: string; version_number: number }
    >(
      `
        SELECT e.id, e.lineage_id, e.title, e.type, e.created_at, e.version_number
        FROM entries e
        INNER JOIN entry_tags et ON et.entry_id = e.id
        INNER JOIN tags t ON t.id = et.tag_id
        WHERE e.is_latest = 1
          AND e.status = 'active'
          AND t.name = 'agent'
        ORDER BY e.updated_at DESC
      `
    )
    .all();

  const seenLineages = new Set(skillAgents.map((a) => a.lineage_id));

  const taggedAgents: SkillListItem[] = taggedRows
    .filter((row) => !seenLineages.has(row.lineage_id))
    .map((row) => ({
      entry_id: row.id,
      lineage_id: row.lineage_id,
      title: row.title,
      tags: listTagsForEntry(db, row.id),
      created_at: row.created_at,
      skill_type: AGENT_SKILL_TYPE,
      latest_version: row.version_number
    }));

  // Apply additional tag filters if provided
  let combined = [...skillAgents, ...taggedAgents];

  if (input.tags && input.tags.length > 0) {
    const expected = input.tags.map((tag) => tag.trim().toLowerCase());
    combined = combined.filter((item) => expected.every((tag) => item.tags.includes(tag)));
  }

  return combined.slice(0, limit);
}

export function loadAgent(db: Database.Database, input: LoadAgentInput): SkillLoadResult {
  // First try loading as a skill-type agent
  try {
    const result = loadSkill(db, {
      skill_lineage_id: input.agent_lineage_id,
      skill_entry_id: input.agent_entry_id
    });

    assertAgentSkill(result.skill.metadata);
    return result;
  } catch {
    // Fall through to load as a tagged entry
  }

  // Fall back to loading any entry tagged "agent"
  const identifier = input.agent_entry_id ?? input.agent_lineage_id ?? "";
  const row = input.agent_entry_id
    ? db
        .prepare<
          [string],
          { id: string; lineage_id: string; title: string; body_markdown: string; metadata_json: string; created_at: string; version_number: number }
        >(
          `
            SELECT id, lineage_id, title, body_markdown, metadata_json, created_at, version_number
            FROM entries
            WHERE id = ? AND is_latest = 1 AND status = 'active'
            LIMIT 1
          `
        )
        .get(input.agent_entry_id)
    : db
        .prepare<
          [string],
          { id: string; lineage_id: string; title: string; body_markdown: string; metadata_json: string; created_at: string; version_number: number }
        >(
          `
            SELECT id, lineage_id, title, body_markdown, metadata_json, created_at, version_number
            FROM entries
            WHERE lineage_id = ? AND is_latest = 1 AND status = 'active'
            LIMIT 1
          `
        )
        .get(identifier);

  if (!row) {
    throw new DomainError("ENTRY_NOT_FOUND", "Agent entry was not found", "Check agent ID or lineage");
  }

  const tags = listTagsForEntry(db, row.id);
  if (!tags.includes("agent")) {
    throw new DomainError("ENTRY_NOT_FOUND", "Agent entry was not found", "Check agent ID or lineage");
  }

  const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;

  return {
    skill: {
      entry_id: row.id,
      lineage_id: row.lineage_id,
      title: row.title,
      tags,
      created_at: row.created_at,
      skill_type: AGENT_SKILL_TYPE,
      latest_version: row.version_number,
      metadata: metadata as SkillLoadResult["skill"]["metadata"],
      body_markdown: row.body_markdown
    },
    resolved_sub_skills: [],
    related_mistakes: [],
    related_lessons: []
  };
}

export function deleteAgent(db: Database.Database, input: DeleteAgentInput) {
  const loaded = loadAgent(db, { agent_lineage_id: input.agent_lineage_id });
  return archiveEntry(db, loaded.skill.lineage_id);
}
