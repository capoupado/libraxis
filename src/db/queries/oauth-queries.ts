import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OAuthClientRow {
  client_id: string;
  client_secret: string | null;
  client_secret_expires_at: number | null;
  client_id_issued_at: number;
  metadata_json: string;
  created_at: string;
}

export interface OAuthAuthorizationCodeRow {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string;
  expires_at: string;
  used: number;
  created_at: string;
}

export interface OAuthRefreshTokenRow {
  token_hash: string;
  client_id: string;
  api_key_id: string;
  scopes: string;
  expires_at: string;
  is_revoked: number;
  created_at: string;
}

// ── Client queries ────────────────────────────────────────────────────────────

export function createOAuthClient(
  db: Database.Database,
  client: OAuthClientInformationFull
): void {
  const { client_id, client_secret, client_secret_expires_at, client_id_issued_at, ...metadata } =
    client;
  db.prepare(
    `INSERT INTO oauth_clients(client_id, client_secret, client_secret_expires_at, client_id_issued_at, metadata_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    client_id,
    client_secret ?? null,
    client_secret_expires_at ?? null,
    client_id_issued_at ?? Math.floor(Date.now() / 1000),
    JSON.stringify(metadata)
  );
}

export function getOAuthClient(
  db: Database.Database,
  clientId: string
): OAuthClientRow | undefined {
  return db
    .prepare<[string], OAuthClientRow>("SELECT * FROM oauth_clients WHERE client_id = ?")
    .get(clientId);
}

export function generateClientId(): string {
  return randomUUID();
}

// ── Authorization code queries ────────────────────────────────────────────────

export interface CreateAuthorizationCodeInput {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string;
  expiresAt: string;
}

export function createAuthorizationCode(
  db: Database.Database,
  input: CreateAuthorizationCodeInput
): void {
  db.prepare(
    `INSERT INTO oauth_authorization_codes(code, client_id, redirect_uri, code_challenge, scopes, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    input.code,
    input.clientId,
    input.redirectUri,
    input.codeChallenge,
    input.scopes,
    input.expiresAt
  );
}

export function getAuthorizationCode(
  db: Database.Database,
  code: string
): OAuthAuthorizationCodeRow | undefined {
  return db
    .prepare<[string], OAuthAuthorizationCodeRow>(
      "SELECT * FROM oauth_authorization_codes WHERE code = ?"
    )
    .get(code);
}

export function markAuthorizationCodeUsed(db: Database.Database, code: string): void {
  db.prepare("UPDATE oauth_authorization_codes SET used = 1 WHERE code = ?").run(code);
}

// ── Refresh token queries ─────────────────────────────────────────────────────

export interface CreateRefreshTokenInput {
  tokenHash: string;
  clientId: string;
  apiKeyId: string;
  scopes: string;
  expiresAt: string;
}

export function createRefreshToken(
  db: Database.Database,
  input: CreateRefreshTokenInput
): void {
  db.prepare(
    `INSERT INTO oauth_refresh_tokens(token_hash, client_id, api_key_id, scopes, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(input.tokenHash, input.clientId, input.apiKeyId, input.scopes, input.expiresAt);
}

export function getRefreshTokenByHash(
  db: Database.Database,
  tokenHash: string
): OAuthRefreshTokenRow | undefined {
  return db
    .prepare<[string], OAuthRefreshTokenRow>(
      "SELECT * FROM oauth_refresh_tokens WHERE token_hash = ? AND is_revoked = 0"
    )
    .get(tokenHash);
}

export function revokeRefreshToken(db: Database.Database, tokenHash: string): void {
  db.prepare("UPDATE oauth_refresh_tokens SET is_revoked = 1 WHERE token_hash = ?").run(tokenHash);
}

export function revokeRefreshTokensByApiKeyId(db: Database.Database, apiKeyId: string): void {
  db.prepare("UPDATE oauth_refresh_tokens SET is_revoked = 1 WHERE api_key_id = ?").run(apiKeyId);
}
