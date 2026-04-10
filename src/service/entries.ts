import type Database from "better-sqlite3";
import { ulid } from "ulid";

import {
  archiveEntryLineage,
  createEntry as createEntryRow,
  diagnoseLineageLookup,
  getLatestEntryByLineage,
  listEntryHistory,
  markPreviousVersionsNotLatest,
  type EntryRow,
  type EntryType
} from "../db/queries/entry-queries.js";
import { listTagsForEntry } from "../db/queries/tag-queries.js";
import { DomainError } from "./errors.js";
import { suggestRelations } from "./related.js";
import { attachTags } from "./tags.js";
import { evaluateContentLimits } from "./validation/content-limits.js";

// Minimal logger shim — replace with pino/winston if the project adopts one.
const logger = {
  warn: (obj: Record<string, unknown>, msg: string) => {
    // eslint-disable-next-line no-console
    console.warn(msg, obj);
  },
};

export interface CreateEntryInput {
  type: EntryType;
  title: string;
  body_markdown: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  created_by: string;
}

export interface UpdateEntryInput {
  lineage_id: string;
  expected_version: number;
  title?: string;
  body_markdown: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  created_by: string;
  allow_skill_direct_update?: boolean;
}

export interface EntryWriteResult {
  entry_id: string;
  lineage_id: string;
  version_number: number;
  warnings?: string[];
}

export interface EntryArchiveResult {
  lineage_id: string;
  status: "archived";
}

export type EntryHistoryItem = EntryRow & { tags: string[] };

export interface EntrySearchItem {
  id: string;
  lineage_id: string;
  title: string;
  type: EntryType;
  tags: string[];
}

function parseStoredMetadata(metadataJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

export function createEntry(db: Database.Database, input: CreateEntryInput): EntryWriteResult {
  const contentCheck = evaluateContentLimits(input.body_markdown);
  const entryId = ulid();
  const lineageId = ulid();
  const versionNumber = 1;

  const writeTransaction = db.transaction(() => {
    createEntryRow(db, {
      id: entryId,
      lineageId,
      type: input.type,
      title: input.title,
      bodyMarkdown: input.body_markdown,
      metadataJson: JSON.stringify(input.metadata ?? {}),
      versionNumber,
      createdBy: input.created_by
    });

    if (input.tags && input.tags.length > 0) {
      attachTags(db, entryId, input.tags);
    }
  });

  writeTransaction();

  try {
    suggestRelations(db, entryId);
  } catch (err) {
    logger.warn({ err }, "suggestRelations failed silently");
  }

  return {
    entry_id: entryId,
    lineage_id: lineageId,
    version_number: versionNumber,
    warnings: contentCheck.warning ? [contentCheck.warning] : undefined
  };
}

export function updateEntry(db: Database.Database, input: UpdateEntryInput): EntryWriteResult {
  const contentCheck = evaluateContentLimits(input.body_markdown);
  const latest = getLatestEntryByLineage(db, input.lineage_id);

  if (!latest) {
    const diagnosis = diagnoseLineageLookup(db, input.lineage_id);
    if (diagnosis.kind === "is_entry_id") {
      throw new DomainError(
        "ENTRY_NOT_FOUND",
        `Provided value is an entry_id, not a lineage_id. Correct lineage_id: ${diagnosis.actualLineageId}`,
        "Re-call with lineage_id from the original create_entry response (NOT entry_id)."
      );
    }
    if (diagnosis.kind === "orphan") {
      throw new DomainError(
        "ENTRY_NOT_FOUND",
        `Lineage ${input.lineage_id} has no head row (is_latest=1). Possible corrupt state.`,
        "Inspect entries table and file a bug."
      );
    }
    throw new DomainError("ENTRY_NOT_FOUND", `Lineage not found: ${input.lineage_id}`);
  }

  if (latest.version_number !== input.expected_version) {
    throw new DomainError(
      "VERSION_CONFLICT",
      `Expected version ${input.expected_version} but latest is ${latest.version_number}`,
      "Reload the entry and retry with the latest version token."
    );
  }

  if (latest.status === "archived") {
    throw new DomainError(
      "FORBIDDEN",
      "Archived entries cannot be edited",
      "Use an active entry lineage for updates."
    );
  }

  if (latest.type === "skill" && input.allow_skill_direct_update !== true) {
    throw new DomainError(
      "SKILL_UPDATE_REQUIRES_PROPOSAL",
      "Direct skill updates are blocked for agent write paths",
      "Use the skill proposal workflow instead."
    );
  }

  const newEntryId = ulid();
  const newVersion = latest.version_number + 1;
  const tagsToAttach = input.tags ?? listTagsForEntry(db, latest.id);

  const writeTransaction = db.transaction(() => {
    markPreviousVersionsNotLatest(db, input.lineage_id);
    createEntryRow(db, {
      id: newEntryId,
      lineageId: input.lineage_id,
      type: latest.type,
      title: input.title ?? latest.title,
      bodyMarkdown: input.body_markdown,
      metadataJson: JSON.stringify(input.metadata ?? parseStoredMetadata(latest.metadata_json)),
      parentId: latest.id,
      versionNumber: newVersion,
      createdBy: input.created_by
    });

    if (tagsToAttach.length > 0) {
      attachTags(db, newEntryId, tagsToAttach);
    }
  });

  writeTransaction();

  try {
    suggestRelations(db, newEntryId);
  } catch (err) {
    logger.warn({ err }, "suggestRelations failed silently");
  }

  return {
    entry_id: newEntryId,
    lineage_id: input.lineage_id,
    version_number: newVersion,
    warnings: contentCheck.warning ? [contentCheck.warning] : undefined
  };
}

export function getEntryHistory(db: Database.Database, lineageId: string): EntryHistoryItem[] {
  return listEntryHistory(db, lineageId).map((row) => ({
    ...row,
    tags: listTagsForEntry(db, row.id)
  }));
}

export function archiveEntry(db: Database.Database, lineageId: string): EntryArchiveResult {
  const latest = getLatestEntryByLineage(db, lineageId);

  if (!latest) {
    const diagnosis = diagnoseLineageLookup(db, lineageId);
    if (diagnosis.kind === "is_entry_id") {
      throw new DomainError(
        "ENTRY_NOT_FOUND",
        `Provided value is an entry_id, not a lineage_id. Correct lineage_id: ${diagnosis.actualLineageId}`,
        "Re-call with lineage_id from the original create_entry response (NOT entry_id)."
      );
    }
    if (diagnosis.kind === "orphan") {
      throw new DomainError(
        "ENTRY_NOT_FOUND",
        `Lineage ${lineageId} has no head row (is_latest=1). Possible corrupt state.`,
        "Inspect entries table and file a bug."
      );
    }
    throw new DomainError("ENTRY_NOT_FOUND", `Lineage not found: ${lineageId}`);
  }

  archiveEntryLineage(db, lineageId);

  return {
    lineage_id: lineageId,
    status: "archived"
  };
}

export function searchEntries(db: Database.Database, query: string, limit = 20): EntrySearchItem[] {
  const like = `%${query.toLowerCase()}%`;
  const rows = db
    .prepare<
      [string, string, number],
      { id: string; lineage_id: string; title: string; type: EntryType }
    >(
      `
        SELECT id, lineage_id, title, type
        FROM entries
        WHERE is_latest = 1
          AND status = 'active'
          AND (lower(title) LIKE ? OR lower(body_markdown) LIKE ?)
        ORDER BY created_at DESC
        LIMIT ?
      `
    )
    .all(like, like, limit);

  return rows.map((row) => ({
    ...row,
    tags: listTagsForEntry(db, row.id)
  }));
}
