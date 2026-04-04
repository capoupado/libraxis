import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type Database from "better-sqlite3";

import { env } from "../../config/env.js";
import { closeDatabaseConnection, getDatabaseConnection } from "../connection.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function listSqlMigrations(migrationsDir: string): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export function runMigrations(db: Database.Database, migrationsDir: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const appliedMigrations = new Set<string>(
    db
      .prepare<[], { name: string }>("SELECT name FROM schema_migrations")
      .all()
      .map((row: { name: string }) => row.name)
  );

  const migrationFiles = listSqlMigrations(migrationsDir);
  const recordMigration = db.prepare("INSERT INTO schema_migrations(name) VALUES (?)");

  for (const migrationName of migrationFiles) {
    if (appliedMigrations.has(migrationName)) {
      continue;
    }

    const migrationSql = fs.readFileSync(path.join(migrationsDir, migrationName), "utf8");

    const apply = db.transaction(() => {
      db.exec(migrationSql);
      recordMigration.run(migrationName);
    });

    apply();
  }
}

export function defaultMigrationsDir(): string {
  return __dirname;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = getDatabaseConnection(env.LIBRAXIS_DB_PATH);

  try {
    runMigrations(db, defaultMigrationsDir());
    process.stdout.write("Migrations complete\n");
  } finally {
    closeDatabaseConnection();
  }
}
