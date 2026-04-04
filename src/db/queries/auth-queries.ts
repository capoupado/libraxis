import type Database from "better-sqlite3";

import { ulid } from "ulid";

export interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string;
  scopes: string;
  is_revoked: number;
  created_at: string;
  last_used_at: string | null;
}

export interface WebSessionRow {
  id: string;
  owner_username: string;
  issued_at: string;
  expires_at: string;
  csrf_token: string;
}

export interface CreateApiKeyInput {
  name: string;
  keyHash: string;
  scopes: string;
}

export function createApiKey(db: Database.Database, input: CreateApiKeyInput): string {
  const id = ulid();
  db.prepare("INSERT INTO api_keys(id, name, key_hash, scopes) VALUES (?, ?, ?, ?)").run(
    id,
    input.name,
    input.keyHash,
    input.scopes
  );
  return id;
}

export function listApiKeys(db: Database.Database): ApiKeyRow[] {
  return db.prepare<[], ApiKeyRow>("SELECT * FROM api_keys ORDER BY created_at DESC").all();
}

export function getApiKeyById(db: Database.Database, id: string): ApiKeyRow | undefined {
  return db.prepare<[string], ApiKeyRow>("SELECT * FROM api_keys WHERE id = ?").get(id);
}

export function getActiveApiKeyByHash(db: Database.Database, keyHash: string): ApiKeyRow | undefined {
  return db
    .prepare<[string], ApiKeyRow>("SELECT * FROM api_keys WHERE key_hash = ? AND is_revoked = 0")
    .get(keyHash);
}

export function getApiKeyByName(db: Database.Database, name: string): ApiKeyRow | undefined {
  return db.prepare<[string], ApiKeyRow>("SELECT * FROM api_keys WHERE name = ?").get(name);
}

export function revokeApiKey(db: Database.Database, id: string): void {
  db.prepare("UPDATE api_keys SET is_revoked = 1 WHERE id = ?").run(id);
}

export function markApiKeyUsed(db: Database.Database, id: string): void {
  db.prepare(
    "UPDATE api_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
  ).run(id);
}

export function markApiKeyUsedIfActive(db: Database.Database, id: string): boolean {
  const result = db
    .prepare(
      "UPDATE api_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND is_revoked = 0"
    )
    .run(id);
  return result.changes > 0;
}

export function createWebSession(db: Database.Database, session: WebSessionRow): void {
  db.prepare(
    `
      INSERT INTO web_sessions(id, owner_username, issued_at, expires_at, csrf_token)
      VALUES (?, ?, ?, ?, ?)
    `
  ).run(session.id, session.owner_username, session.issued_at, session.expires_at, session.csrf_token);
}

export function getWebSession(db: Database.Database, id: string): WebSessionRow | undefined {
  return db.prepare<[string], WebSessionRow>("SELECT * FROM web_sessions WHERE id = ?").get(id);
}

export function deleteWebSession(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM web_sessions WHERE id = ?").run(id);
}
