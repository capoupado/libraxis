import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { parseEnv } from "../../src/config/env.js";
import { createDatabaseConnection } from "../../src/db/connection.js";
import {
  defaultMigrationsDir,
  runMigrations
} from "../../src/db/migrations/run-migrations.js";

const APPEND_ONLY_VERSION_CHECKLIST = [
  "exactly one latest row per lineage",
  "new version requires previous latest demotion",
  "version progression can continue with parent_id linkage"
] as const;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function setupDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "libraxis-foundation-"));
  tempDirs.push(dir);
  const dbPath = path.join(dir, "libraxis.db");
  return createDatabaseConnection(dbPath);
}

describe("foundation migrations", () => {
  it("rejects default owner credentials in production", () => {
    expect(() =>
      parseEnv({
        ...process.env,
        NODE_ENV: "production",
        LIBRAXIS_ADMIN_USERNAME: "admin",
        LIBRAXIS_ADMIN_PASSWORD: "change-me"
      })
    ).toThrow(/Production requires non-default owner credentials/);
  });

  it("accepts non-default owner credentials in production", () => {
    const parsed = parseEnv({
      ...process.env,
      NODE_ENV: "production",
      LIBRAXIS_ADMIN_USERNAME: "owner",
      LIBRAXIS_ADMIN_PASSWORD: "strong-secret-password"
    });

    expect(parsed.NODE_ENV).toBe("production");
    expect(parsed.LIBRAXIS_ADMIN_USERNAME).toBe("owner");
  });

  it("declares append-only integrity checklist items", () => {
    expect(APPEND_ONLY_VERSION_CHECKLIST).toEqual([
      "exactly one latest row per lineage",
      "new version requires previous latest demotion",
      "version progression can continue with parent_id linkage"
    ]);
  });

  it("applies migration and can be run idempotently", () => {
    const db = setupDb();

    try {
      runMigrations(db, defaultMigrationsDir());
      runMigrations(db, defaultMigrationsDir());

      const tableNames = db
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('entries','tags','entry_links','skill_proposals','api_keys') ORDER BY name"
        )
        .all()
        .map((row: { name: string }) => row.name);

      expect(tableNames).toEqual(["api_keys", "entries", "entry_links", "skill_proposals", "tags"]);

      const migrationCount = db
        .prepare<[], { count: number }>("SELECT COUNT(*) as count FROM schema_migrations")
        .get();

      const migrationFiles = fs
        .readdirSync(defaultMigrationsDir())
        .filter((file) => file.endsWith(".sql"));

      expect(migrationCount?.count).toBe(migrationFiles.length);
    } finally {
      db.close();
    }
  });

  it("enforces one latest row per lineage for append-only integrity", () => {
    const db = setupDb();

    try {
      runMigrations(db, defaultMigrationsDir());

      db.prepare(
        `
        INSERT INTO entries(
          id, lineage_id, type, title, body_markdown, metadata_json,
          version_number, is_latest, created_by
        ) VALUES (?, ?, 'note', ?, ?, '{}', ?, ?, ?)
      `
      ).run("e1", "l1", "v1", "content", 1, 1, "tester");

      expect(() => {
        db.prepare(
          `
          INSERT INTO entries(
            id, lineage_id, type, title, body_markdown, metadata_json,
            version_number, is_latest, created_by
          ) VALUES (?, ?, 'note', ?, ?, '{}', ?, ?, ?)
        `
        ).run("e2", "l1", "v2", "content-2", 2, 1, "tester");
      }).toThrow();

      db.prepare("UPDATE entries SET is_latest = 0 WHERE id = 'e1'").run();
      db.prepare(
        `
          INSERT INTO entries(
            id, lineage_id, type, title, body_markdown, metadata_json,
            parent_id, version_number, is_latest, created_by
          ) VALUES (?, ?, 'note', ?, ?, '{}', ?, ?, ?, ?)
        `
      ).run("e2", "l1", "v2", "content-2", "e1", 2, 1, "tester");

      const latest = db
        .prepare<[], { id: string }>("SELECT id FROM entries WHERE lineage_id = 'l1' AND is_latest = 1")
        .get();
      expect(latest?.id).toBe("e2");
    } finally {
      db.close();
    }
  });
});
