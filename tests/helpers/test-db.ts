import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type Database from "better-sqlite3";

import { createDatabaseConnection } from "../../src/db/connection.js";
import { defaultMigrationsDir, runMigrations } from "../../src/db/migrations/run-migrations.js";

export interface TestDbContext {
  db: Database.Database;
  cleanup: () => void;
}

export function createMigratedTestDb(): TestDbContext {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "libraxis-test-"));
  const dbPath = path.join(tempDir, "test.db");
  const db = createDatabaseConnection(dbPath);
  runMigrations(db, defaultMigrationsDir());

  return {
    db,
    cleanup: () => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

export function seedUs1Data(db: Database.Database): void {
  db.prepare(
    `
      INSERT INTO entries(
        id, lineage_id, type, title, body_markdown, metadata_json,
        version_number, is_latest, created_by
      ) VALUES
      ('skill-a-v1', 'skill-a', 'skill', 'Skill A', 'Use checklist and verify outputs.', '{"skill_type":"workflow","steps":[{"action":"prepare"},{"skill_ref":"skill-b"}]}', 1, 1, 'seed'),
      ('skill-b-v1', 'skill-b', 'skill', 'Skill B', 'Validate context and perform action.', '{"skill_type":"instructions","steps":[{"action":"validate"}]}', 1, 1, 'seed'),
      ('mistake-1', 'mistake-1', 'mistake', 'Mistake One', 'Do not skip validation.', '{"severity":"high"}', 1, 1, 'seed'),
      ('lesson-1', 'lesson-1', 'lesson', 'Lesson One', 'Always run contract checks first.', '{"category":"quality"}', 1, 1, 'seed')
    `
  ).run();

  db.prepare(
    `
      INSERT INTO tags(id, name) VALUES
      ('tag-1', 'automation'),
      ('tag-2', 'quality')
    `
  ).run();

  db.prepare(
    `
      INSERT INTO entry_tags(entry_id, tag_id) VALUES
      ('skill-a-v1', 'tag-1'),
      ('skill-b-v1', 'tag-2')
    `
  ).run();

  db.prepare(
    `
      INSERT INTO entry_links(id, source_entry_id, target_entry_id, relation_type, created_by)
      VALUES
      ('link-1', 'skill-a-v1', 'mistake-1', 'related_to', 'seed'),
      ('link-2', 'skill-a-v1', 'lesson-1', 'resolved_by', 'seed')
    `
  ).run();
}
