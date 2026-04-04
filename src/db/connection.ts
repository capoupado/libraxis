import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let singletonDb: Database.Database | null = null;

function ensureParentDirExists(dbPath: string): void {
  const parentDir = path.dirname(dbPath);
  fs.mkdirSync(parentDir, { recursive: true });
}

function enforceDatabasePermissions(dbPath: string): void {
  try {
    fs.chmodSync(dbPath, 0o600);
  } catch {
    // Ignore platforms or filesystems that do not support chmod semantics.
  }
}

export function createDatabaseConnection(dbPath: string): Database.Database {
  ensureParentDirExists(dbPath);
  const db = new Database(dbPath);
  enforceDatabasePermissions(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  return db;
}

export function getDatabaseConnection(dbPath: string): Database.Database {
  if (singletonDb === null) {
    singletonDb = createDatabaseConnection(dbPath);
  }

  return singletonDb;
}

export function closeDatabaseConnection(): void {
  if (singletonDb !== null) {
    singletonDb.close();
    singletonDb = null;
  }
}
