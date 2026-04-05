import type Database from "better-sqlite3";
import { z } from "zod";

import type { BaseMcpServer } from "../server.js";
import { createEntry, updateEntry } from "../../service/entries.js";
import { linkEntries } from "../../service/links.js";
import { logMistakeWithLesson } from "../../service/mistakes-lessons.js";

const createEntrySchema = z.object({
  type: z.enum(["lesson", "note", "skill", "user", "feedback", "project", "reference"]),
  title: z.string().min(1),
  body_markdown: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().min(1)).optional(),
  created_by: z.string().min(1).default("agent")
});

const updateEntrySchema = z.object({
  lineage_id: z.string().min(1),
  expected_version: z.number().int().positive(),
  body_markdown: z.string().min(1),
  title: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().min(1)).optional(),
  created_by: z.string().min(1).default("agent")
});

const logMistakeLessonSchema = z.object({
  mistake_title: z.string().min(1),
  mistake_body: z.string().min(1),
  lesson_title: z.string().min(1),
  lesson_body: z.string().min(1),
  tags: z.array(z.string()).optional(),
  created_by: z.string().min(1).default("agent")
});

const linkEntriesSchema = z.object({
  source_entry_id: z.string().min(1),
  target_entry_id: z.string().min(1),
  relation_type: z.string().min(1),
  created_by: z.string().min(1).default("agent")
});

export function registerEntryTools(server: BaseMcpServer, db: Database.Database): void {
  server.registerTool("libraxis_create_entry", async (input) => {
    const parsed = createEntrySchema.parse(input);
    return createEntry(db, parsed);
  });

  server.registerTool("libraxis_update_entry", async (input) => {
    const parsed = updateEntrySchema.parse(input);
    return updateEntry(db, {
      ...parsed,
      allow_skill_direct_update: false
    });
  });

  server.registerTool("libraxis_log_mistake_with_lesson", async (input) => {
    const parsed = logMistakeLessonSchema.parse(input);
    return logMistakeWithLesson(db, parsed);
  });

  server.registerTool("libraxis_link_entries", async (input) => {
    const parsed = linkEntriesSchema.parse(input);
    return linkEntries(db, parsed);
  });
}
