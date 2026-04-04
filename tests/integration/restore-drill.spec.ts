import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { createDatabaseConnection } from "../../src/db/connection.js";
import { defaultMigrationsDir, runMigrations } from "../../src/db/migrations/run-migrations.js";

describe("operations: backup and restore drill", () => {
  it("backs up and restores the database with data intact", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "libraxis-restore-drill-"));
    const dbPath = path.join(tempDir, "libraxis.db");
    const backupDir = path.join(tempDir, "backups");

    try {
      const db = createDatabaseConnection(dbPath);
      runMigrations(db, defaultMigrationsDir());
      db.prepare(
        "INSERT INTO entries(id, lineage_id, type, title, body_markdown, metadata_json, version_number, is_latest, created_by) VALUES ('drill-1','drill-1','note','Drill','restore me','{}',1,1,'test')"
      ).run();
      db.close();

      execFileSync("bash", ["scripts/backup.sh", dbPath, backupDir], {
        cwd: process.cwd(),
        stdio: "pipe"
      });

      fs.rmSync(dbPath, { force: true });

      const backups = fs.readdirSync(backupDir);
      expect(backups.length).toBeGreaterThan(0);

      const latestBackup = path.join(backupDir, backups.sort().at(-1)!);
      execFileSync("bash", ["scripts/restore.sh", latestBackup, dbPath], {
        cwd: process.cwd(),
        stdio: "pipe"
      });

      const restored = createDatabaseConnection(dbPath);
      const count = restored
        .prepare<[], { c: number }>("SELECT COUNT(*) as c FROM entries WHERE id = 'drill-1'")
        .get();
      restored.close();

      expect(count?.c).toBe(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
