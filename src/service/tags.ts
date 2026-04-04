import type Database from "better-sqlite3";

import { attachTagToEntry, detachTagFromEntry, listTagsForEntry } from "../db/queries/tag-queries.js";
import { DomainError } from "./errors.js";
import { tagAllowlistPattern } from "./validation/schemas.js";

function normalizeTagName(tag: string): string {
  return tag.trim().toLowerCase();
}

function assertValidTagName(tag: string): void {
  if (!tagAllowlistPattern.test(tag)) {
    throw new DomainError(
      "INVALID_INPUT",
      `Invalid tag: ${tag}`,
      "Use lowercase letters, numbers, hyphen, or underscore."
    );
  }
}

export function attachTags(db: Database.Database, entryId: string, tags: string[]): string[] {
  const normalized = Array.from(new Set(tags.map((tag) => normalizeTagName(tag)).filter(Boolean)));
  for (const tag of normalized) {
    assertValidTagName(tag);
    attachTagToEntry(db, entryId, tag);
  }
  return listTagsForEntry(db, entryId);
}

export function detachTag(db: Database.Database, entryId: string, tag: string): string[] {
  const normalized = normalizeTagName(tag);
  if (!normalized) {
    throw new DomainError("INVALID_INPUT", "Tag cannot be empty");
  }

  assertValidTagName(normalized);
  detachTagFromEntry(db, entryId, normalized);
  return listTagsForEntry(db, entryId);
}
