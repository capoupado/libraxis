import type Database from "better-sqlite3";

import { DomainError } from "./errors.js";

export interface SkillStep {
  skill_ref?: string;
  [key: string]: unknown;
}

export interface SkillMetadata {
  skill_type?: string;
  steps?: SkillStep[];
  [key: string]: unknown;
}

export interface ResolvedSkill {
  entry_id: string;
  lineage_id: string;
  title: string;
  metadata: SkillMetadata;
}

interface SkillRow {
  id: string;
  lineage_id: string;
  title: string;
  metadata_json: string;
}

function parseSkillMetadata(metadataJson: string): SkillMetadata {
  const parsed = JSON.parse(metadataJson) as unknown;
  if (typeof parsed === "object" && parsed !== null) {
    return parsed as SkillMetadata;
  }
  return {};
}

export function resolveOneLevelSubSkills(
  db: Database.Database,
  parentSkillId: string,
  parentLineageId: string,
  metadata: SkillMetadata
): ResolvedSkill[] {
  const steps = Array.isArray(metadata.steps) ? metadata.steps : [];
  const refs = steps
    .map((step) => step.skill_ref)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const uniqueRefs = Array.from(new Set(refs));
  const resolved: ResolvedSkill[] = [];

  for (const ref of uniqueRefs) {
    if (ref === parentSkillId || ref === parentLineageId) {
      throw new DomainError(
        "SKILL_REFERENCE_INVALID",
        `Skill reference cycle detected for ${ref}`,
        "Remove self-referencing skill_ref values from composite steps."
      );
    }

    const subSkill = db
      .prepare<[string, string], SkillRow>(
        `
          SELECT id, lineage_id, title, metadata_json
          FROM entries
          WHERE type = 'skill'
            AND is_latest = 1
            AND status = 'active'
            AND (id = ? OR lineage_id = ?)
          LIMIT 1
        `
      )
      .get(ref, ref);

    if (!subSkill) {
      throw new DomainError(
        "SKILL_REFERENCE_INVALID",
        `Missing referenced sub-skill ${ref}`,
        "Ensure referenced skill IDs/lineages exist and are latest."
      );
    }

    resolved.push({
      entry_id: subSkill.id,
      lineage_id: subSkill.lineage_id,
      title: subSkill.title,
      metadata: parseSkillMetadata(subSkill.metadata_json)
    });
  }

  return resolved;
}
