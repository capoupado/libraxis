import type Database from "better-sqlite3";

import { listTagsForEntry } from "../db/queries/tag-queries.js";
import { DomainError } from "./errors.js";
import { resolveOneLevelSubSkills, type SkillMetadata } from "./skill-resolver.js";

interface SkillRow {
  id: string;
  lineage_id: string;
  title: string;
  body_markdown: string;
  metadata_json: string;
  created_at: string;
  version_number: number;
}

interface RelatedEntryRow {
  id: string;
  lineage_id: string;
  type: "mistake" | "lesson";
  title: string;
}

export interface SkillListParams {
  tags?: string[];
  skill_type?: string;
  limit?: number;
}

export interface SkillListItem {
  entry_id: string;
  lineage_id: string;
  title: string;
  tags: string[];
  created_at: string;
  skill_type: string;
  latest_version: number;
}

export interface SkillLoadResult {
  skill: SkillListItem & { metadata: SkillMetadata; body_markdown: string };
  resolved_sub_skills: Array<{
    entry_id: string;
    lineage_id: string;
    title: string;
    metadata: SkillMetadata;
  }>;
  related_mistakes: Array<{ entry_id: string; lineage_id: string; title: string }>;
  related_lessons: Array<{ entry_id: string; lineage_id: string; title: string }>;
}

function parseMetadata(metadataJson: string): SkillMetadata {
  const parsed = JSON.parse(metadataJson) as unknown;
  if (typeof parsed === "object" && parsed !== null) {
    return parsed as SkillMetadata;
  }
  return {};
}

function toSkillListItem(db: Database.Database, row: SkillRow): SkillListItem {
  const metadata = parseMetadata(row.metadata_json);

  return {
    entry_id: row.id,
    lineage_id: row.lineage_id,
    title: row.title,
    tags: listTagsForEntry(db, row.id),
    created_at: row.created_at,
    skill_type: typeof metadata.skill_type === "string" ? metadata.skill_type : "instructions",
    latest_version: row.version_number
  };
}

export function listSkills(db: Database.Database, params: SkillListParams = {}): SkillListItem[] {
  const limit = params.limit ?? 20;
  const rows = db
    .prepare<[], SkillRow>(
      `
        SELECT id, lineage_id, title, body_markdown, metadata_json, created_at, version_number
        FROM entries
        WHERE type = 'skill'
          AND is_latest = 1
          AND status = 'active'
        ORDER BY updated_at DESC
      `
    )
    .all();

  let items = rows.map((row) => toSkillListItem(db, row));

  if (params.skill_type) {
    items = items.filter((item) => item.skill_type === params.skill_type);
  }

  if (params.tags && params.tags.length > 0) {
    const expected = params.tags.map((tag) => tag.trim().toLowerCase());
    items = items.filter((item) => expected.every((tag) => item.tags.includes(tag)));
  }

  return items.slice(0, limit);
}

function listRelatedMistakesAndLessons(
  db: Database.Database,
  skillEntryId: string
): {
  related_mistakes: SkillLoadResult["related_mistakes"];
  related_lessons: SkillLoadResult["related_lessons"];
} {
  const rows = db
    .prepare<[string, string, string], RelatedEntryRow>(
      `
        SELECT DISTINCT e.id, e.lineage_id, e.type, e.title
        FROM entry_links l
        INNER JOIN entries e
          ON (e.id = l.source_entry_id OR e.id = l.target_entry_id)
        WHERE (l.source_entry_id = ? OR l.target_entry_id = ?)
          AND e.id <> ?
          AND e.is_latest = 1
          AND e.status = 'active'
          AND e.type IN ('mistake', 'lesson')
      `
    )
    .all(skillEntryId, skillEntryId, skillEntryId);

  return {
    related_mistakes: rows
      .filter((row) => row.type === "mistake")
      .map((row) => ({ entry_id: row.id, lineage_id: row.lineage_id, title: row.title })),
    related_lessons: rows
      .filter((row) => row.type === "lesson")
      .map((row) => ({ entry_id: row.id, lineage_id: row.lineage_id, title: row.title }))
  };
}

export function loadSkill(
  db: Database.Database,
  input: { skill_lineage_id?: string; skill_entry_id?: string }
): SkillLoadResult {
  const row = input.skill_entry_id
    ? db
        .prepare<[string], SkillRow>(
          `
            SELECT id, lineage_id, title, body_markdown, metadata_json, created_at, version_number
            FROM entries
            WHERE id = ? AND type = 'skill' AND is_latest = 1
              AND status = 'active'
            LIMIT 1
          `
        )
        .get(input.skill_entry_id)
    : db
        .prepare<[string], SkillRow>(
          `
            SELECT id, lineage_id, title, body_markdown, metadata_json, created_at, version_number
            FROM entries
            WHERE lineage_id = ? AND type = 'skill' AND is_latest = 1
              AND status = 'active'
            LIMIT 1
          `
        )
        .get(input.skill_lineage_id ?? "");

  if (!row) {
    throw new DomainError("ENTRY_NOT_FOUND", "Skill entry was not found", "Check skill ID or lineage");
  }

  const metadata = parseMetadata(row.metadata_json);
  const resolvedSubSkills = resolveOneLevelSubSkills(db, row.id, row.lineage_id, metadata);
  const related = listRelatedMistakesAndLessons(db, row.id);

  return {
    skill: {
      ...toSkillListItem(db, row),
      metadata,
      body_markdown: row.body_markdown
    },
    resolved_sub_skills: resolvedSubSkills,
    related_mistakes: related.related_mistakes,
    related_lessons: related.related_lessons
  };
}
