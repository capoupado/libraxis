import type Database from "better-sqlite3";

import { createEntryLink, listLinksForEntry } from "../db/queries/link-queries.js";
import { DomainError } from "./errors.js";

interface EntryTypeRow {
  id: string;
  type: "prompt" | "run" | "mistake" | "lesson" | "note" | "skill";
}

function loadEntryType(db: Database.Database, entryId: string): EntryTypeRow {
  const row = db
    .prepare<[string], EntryTypeRow>(
      "SELECT id, type FROM entries WHERE id = ? AND is_latest = 1 AND status = 'active'"
    )
    .get(entryId);

  if (!row) {
    throw new DomainError("ENTRY_NOT_FOUND", `Entry not found: ${entryId}`);
  }

  return row;
}

function validateDirection(
  relationType: string,
  sourceType: EntryTypeRow["type"],
  targetType: EntryTypeRow["type"]
): void {
  if (relationType === "used_skill" && (sourceType !== "run" || targetType !== "skill")) {
    throw new DomainError(
      "INVALID_INPUT",
      "Relation used_skill must be run -> skill",
      "Set source to run entry and target to skill entry."
    );
  }

  if (relationType === "composes" && (sourceType !== "skill" || targetType !== "skill")) {
    throw new DomainError(
      "INVALID_INPUT",
      "Relation composes must be skill -> skill",
      "Use skill entries for both source and target."
    );
  }
}

export function linkEntries(
  db: Database.Database,
  input: {
    source_entry_id: string;
    target_entry_id: string;
    relation_type: string;
    created_by: string;
  }
): { link_id: string } {
  const source = loadEntryType(db, input.source_entry_id);
  const target = loadEntryType(db, input.target_entry_id);
  validateDirection(input.relation_type, source.type, target.type);

  const linkId = createEntryLink(db, {
    sourceEntryId: input.source_entry_id,
    targetEntryId: input.target_entry_id,
    relationType: input.relation_type,
    createdBy: input.created_by
  });

  return { link_id: linkId };
}

export function traverseLinks(db: Database.Database, entryId: string) {
  return listLinksForEntry(db, entryId);
}
