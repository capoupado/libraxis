import type Database from "better-sqlite3";

import {
  createApiKey,
  getActiveApiKeyByHash,
  getApiKeyById,
  listApiKeys,
  markApiKeyUsedIfActive,
  revokeApiKey
} from "../db/queries/auth-queries.js";
import {
  createApiKeyMaterial,
  hashApiKey,
  parseScopes,
  serializeScopes,
  type ApiKeyScope
} from "../auth/api-keys.js";
import { DomainError } from "./errors.js";

export function createMachineApiKey(
  db: Database.Database,
  input: { name: string; scopes: ApiKeyScope[] }
) {
  const material = createApiKeyMaterial();
  const keyId = createApiKey(db, {
    name: input.name,
    keyHash: material.keyHash,
    scopes: serializeScopes(input.scopes)
  });

  return {
    key_id: keyId,
    plaintext_key: material.plaintextKey
  };
}

export function listMachineApiKeys(db: Database.Database) {
  return listApiKeys(db).map((key) => ({
    id: key.id,
    name: key.name,
    scopes: parseScopes(key.scopes),
    is_revoked: Boolean(key.is_revoked),
    created_at: key.created_at,
    last_used_at: key.last_used_at
  }));
}

export function revokeMachineApiKey(db: Database.Database, keyId: string) {
  const key = getApiKeyById(db, keyId);
  if (!key) {
    throw new DomainError("ENTRY_NOT_FOUND", "API key not found");
  }
  revokeApiKey(db, keyId);
  return { revoked: true };
}

export function authenticateApiKey(
  db: Database.Database,
  plaintextKey: string,
  requiredScope: ApiKeyScope
) {
  const matched = getActiveApiKeyByHash(db, hashApiKey(plaintextKey));
  if (!matched) {
    throw new DomainError("AUTH_REQUIRED", "Invalid or revoked API key");
  }

  const scopes = parseScopes(matched.scopes);
  if (!scopes.includes(requiredScope)) {
    throw new DomainError("FORBIDDEN", `API key missing required scope: ${requiredScope}`);
  }

  if (!markApiKeyUsedIfActive(db, matched.id)) {
    throw new DomainError("AUTH_REQUIRED", "Invalid or revoked API key");
  }

  return {
    id: matched.id,
    name: matched.name,
    scopes
  };
}

export function authenticateApiKeyForAnyScope(db: Database.Database, plaintextKey: string) {
  const scopesToTry: ApiKeyScope[] = ["read", "write", "admin"];

  for (const scope of scopesToTry) {
    try {
      return authenticateApiKey(db, plaintextKey, scope);
    } catch (error) {
      if (error instanceof DomainError && error.code === "FORBIDDEN") {
        continue;
      }

      throw error;
    }
  }

  throw new DomainError("FORBIDDEN", "API key has no valid scopes");
}
