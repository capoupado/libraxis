import type Database from "better-sqlite3";

import { createEntry } from "./entries.js";
import { linkEntries } from "./links.js";

export interface LogMistakeWithLessonInput {
  mistake_title: string;
  mistake_body: string;
  lesson_title: string;
  lesson_body: string;
  tags?: string[];
  created_by: string;
}

export interface MistakeLessonResult {
  mistake_entry_id: string;
  lesson_entry_id: string;
  link_id: string;
}

export function logMistakeWithLesson(
  db: Database.Database,
  input: LogMistakeWithLessonInput
): MistakeLessonResult {
  const tx = db.transaction(() => {
    const mistake = createEntry(db, {
      type: "mistake",
      title: input.mistake_title,
      body_markdown: input.mistake_body,
      tags: input.tags,
      created_by: input.created_by,
      metadata: {}
    });

    const lesson = createEntry(db, {
      type: "lesson",
      title: input.lesson_title,
      body_markdown: input.lesson_body,
      tags: input.tags,
      created_by: input.created_by,
      metadata: {}
    });

    const link = linkEntries(db, {
      source_entry_id: mistake.entry_id,
      target_entry_id: lesson.entry_id,
      relation_type: "resolved_by",
      created_by: input.created_by
    });

    return {
      mistake_entry_id: mistake.entry_id,
      lesson_entry_id: lesson.entry_id,
      link_id: link.link_id
    };
  });

  return tx();
}
