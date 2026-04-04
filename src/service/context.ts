import type Database from "better-sqlite3";

import { listTagsForEntry } from "../db/queries/tag-queries.js";

type EntryType = "prompt" | "run" | "mistake" | "lesson" | "note" | "skill";

interface ContextRow {
  id: string;
  lineage_id: string;
  type: EntryType;
  title: string;
  body_markdown: string;
  metadata_json: string;
  created_at: string;
  version_number: number;
}

const TYPE_WEIGHTS: Record<EntryType, number> = {
  skill: 2,
  lesson: 1.5,
  mistake: 1.2,
  prompt: 1,
  run: 0.8,
  note: 0.8
};

function tokenize(taskDescription: string): string[] {
  return taskDescription
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function shapeSnippet(markdown: string): string {
  const normalized = markdown.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) {
    return normalized;
  }

  return `${normalized.slice(0, 177)}...`;
}

function recencyBonus(createdAtIso: string): number {
  const createdAt = new Date(createdAtIso).getTime();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const ageMs = Date.now() - createdAt;
  return ageMs <= thirtyDaysMs ? 0.35 : 0;
}

export interface GetContextInput {
  task_description: string;
  limit?: number;
  include_types?: EntryType[];
}

export interface ContextResultItem {
  entry_id: string;
  lineage_id: string;
  type: EntryType;
  title: string;
  tags: string[];
  created_at: string;
  score: number;
  snippet: string;
  skill_type?: string;
  latest_version?: number;
}

export interface ContextBundle {
  query: string;
  results: ContextResultItem[];
  selected_skills: Array<{ entry_id: string; lineage_id: string; title: string }>;
  related_mistakes: Array<{ entry_id: string; lineage_id: string; title: string }>;
  related_lessons: Array<{ entry_id: string; lineage_id: string; title: string }>;
}

export function getContextBundle(db: Database.Database, input: GetContextInput): ContextBundle {
  const limit = input.limit ?? 20;
  const tokens = tokenize(input.task_description);

  const rows = db
    .prepare<[], ContextRow>(
      `
        SELECT id, lineage_id, type, title, body_markdown, metadata_json, created_at, version_number
        FROM entries
        WHERE is_latest = 1
          AND status = 'active'
        ORDER BY created_at DESC
      `
    )
    .all();

  const filteredRows = input.include_types?.length
    ? rows.filter((row) => input.include_types?.includes(row.type))
    : rows;

  const scored = filteredRows.map((row) => {
    const haystack = `${row.title} ${row.body_markdown}`.toLowerCase();
    const lexicalScore = tokens.reduce((acc, token) => (haystack.includes(token) ? acc + 1 : acc), 0);
    const weighted = (lexicalScore + 0.1) * TYPE_WEIGHTS[row.type] + recencyBonus(row.created_at);
    const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;

    const result: ContextResultItem = {
      entry_id: row.id,
      lineage_id: row.lineage_id,
      type: row.type,
      title: row.title,
      tags: listTagsForEntry(db, row.id),
      created_at: row.created_at,
      score: Number(weighted.toFixed(4)),
      snippet: shapeSnippet(row.body_markdown)
    };

    if (row.type === "skill") {
      result.skill_type =
        typeof metadata.skill_type === "string" ? metadata.skill_type : "instructions";
      result.latest_version = row.version_number;
    }

    return result;
  });

  const ranked = scored.sort((a, b) => b.score - a.score).slice(0, limit);

  // No-match fallback keeps output deterministic while still offering useful context snippets.
  const results = ranked.length === 0 ? scored.slice(0, Math.min(limit, 3)) : ranked;

  return {
    query: input.task_description,
    results,
    selected_skills: results
      .filter((item) => item.type === "skill")
      .slice(0, 5)
      .map((item) => ({
        entry_id: item.entry_id,
        lineage_id: item.lineage_id,
        title: item.title
      })),
    related_mistakes: results
      .filter((item) => item.type === "mistake")
      .map((item) => ({
        entry_id: item.entry_id,
        lineage_id: item.lineage_id,
        title: item.title
      })),
    related_lessons: results
      .filter((item) => item.type === "lesson")
      .map((item) => ({
        entry_id: item.entry_id,
        lineage_id: item.lineage_id,
        title: item.title
      }))
  };
}
