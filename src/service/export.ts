import type Database from "better-sqlite3";

import { getEntryById, getLatestEntryByLineage } from "../db/queries/entry-queries.js";
import { listTagsForEntry } from "../db/queries/tag-queries.js";
import { DomainError } from "./errors.js";
import { toMarkdown } from "./markdown.js";

export function exportEntryMarkdown(
  db: Database.Database,
  input: { entry_id?: string; lineage_id?: string }
) {
  const entry = input.entry_id
    ? getEntryById(db, input.entry_id)
    : getLatestEntryByLineage(db, input.lineage_id ?? "");

  if (!entry) {
    throw new DomainError("ENTRY_NOT_FOUND", "Entry not found for export");
  }

  const markdown = toMarkdown(entry.body_markdown, {
    id: entry.id,
    lineage_id: entry.lineage_id,
    type: entry.type,
    title: entry.title,
    version_number: entry.version_number,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    tags: listTagsForEntry(db, entry.id)
  });

  return {
    filename: `${entry.lineage_id}-v${entry.version_number}.md`,
    markdown
  };
}
