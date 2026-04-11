import crypto, { randomUUID } from "node:crypto";
import type { Response } from "express";
import type Database from "better-sqlite3";
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import { LibraxisOAuthClientsStore } from "./oauth-clients-store.js";
import { createApiKeyMaterial, hashApiKey, serializeScopes } from "./api-keys.js";
import { createApiKey, revokeApiKey } from "../db/queries/auth-queries.js";
import {
  createRefreshToken,
  getAuthorizationCode,
  getRefreshTokenByHash,
  markAuthorizationCodeUsed,
  revokeRefreshToken,
  revokeRefreshTokensByApiKeyId
} from "../db/queries/oauth-queries.js";
import { getActiveApiKeyByHash } from "../db/queries/auth-queries.js";
import { parseScopes } from "./api-keys.js";

export interface PendingAuthRequest {
  clientId: string;
  params: AuthorizationParams;
  res: Response;
}

export class LibraxisOAuthProvider implements OAuthServerProvider {
  private readonly _clientsStore: LibraxisOAuthClientsStore;
  // In-memory map of pending authorization requests, keyed by a short-lived request ID
  private readonly _pendingRequests = new Map<string, PendingAuthRequest>();

  constructor(
    private readonly db: Database.Database,
    private readonly config: {
      accessTokenTtlMinutes: number;
      refreshTokenTtlDays: number;
      codeTtlSeconds: number;
      publicUrl: string;
    }
  ) {
    this._clientsStore = new LibraxisOAuthClientsStore(db);
  }

  get clientsStore(): LibraxisOAuthClientsStore {
    return this._clientsStore;
  }

  // Store a pending request so the consent route can retrieve it
  storePendingRequest(requestId: string, pending: PendingAuthRequest): void {
    this._pendingRequests.set(requestId, pending);
    // Auto-expire after code TTL + buffer
    setTimeout(() => this._pendingRequests.delete(requestId), (this.config.codeTtlSeconds + 60) * 1000);
  }

  getPendingRequest(requestId: string): PendingAuthRequest | undefined {
    return this._pendingRequests.get(requestId);
  }

  deletePendingRequest(requestId: string): void {
    this._pendingRequests.delete(requestId);
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    // Store the request and redirect to our consent UI
    const requestId = randomUUID();
    this.storePendingRequest(requestId, { clientId: client.client_id, params, res });

    const consentUrl = new URL(`${this.config.publicUrl}/oauth/authorize`);
    consentUrl.searchParams.set("request_id", requestId);
    consentUrl.searchParams.set("client_name", client.client_name ?? client.client_id);

    res.redirect(consentUrl.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const row = getAuthorizationCode(this.db, authorizationCode);
    if (!row) {
      throw new Error("Authorization code not found");
    }
    if (row.used) {
      throw new Error("Authorization code already used");
    }
    const expiresAt = new Date(row.expires_at);
    if (expiresAt < new Date()) {
      throw new Error("Authorization code expired");
    }
    return row.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<OAuthTokens> {
    const row = getAuthorizationCode(this.db, authorizationCode);
    if (!row || row.used || new Date(row.expires_at) < new Date()) {
      throw new Error("Invalid or expired authorization code");
    }

    markAuthorizationCodeUsed(this.db, authorizationCode);

    const scopes = row.scopes; // comma-separated
    const material = createApiKeyMaterial();
    const expiresAt = new Date(
      Date.now() + this.config.accessTokenTtlMinutes * 60 * 1000
    ).toISOString();
    const keyName = `oauth:${client.client_id}:${Date.now()}`;

    const keyId = createApiKey(this.db, {
      name: keyName,
      keyHash: material.keyHash,
      scopes,
      expiresAt,
      oauthClientId: client.client_id
    });

    // Create refresh token
    const refreshTokenPlaintext = `lbx_rt_${crypto.randomBytes(32).toString("hex")}`;
    const refreshTokenHash = crypto.createHash("sha256").update(refreshTokenPlaintext).digest("hex");
    const refreshExpiresAt = new Date(
      Date.now() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000
    ).toISOString();

    createRefreshToken(this.db, {
      tokenHash: refreshTokenHash,
      clientId: client.client_id,
      apiKeyId: keyId,
      scopes,
      expiresAt: refreshExpiresAt
    });

    return {
      access_token: material.plaintextKey,
      token_type: "bearer",
      expires_in: this.config.accessTokenTtlMinutes * 60,
      refresh_token: refreshTokenPlaintext,
      scope: scopes.replace(/,/g, " ")
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[]
  ): Promise<OAuthTokens> {
    const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    const row = getRefreshTokenByHash(this.db, tokenHash);

    if (!row || row.client_id !== client.client_id || new Date(row.expires_at) < new Date()) {
      throw new Error("Invalid or expired refresh token");
    }

    // Revoke old tokens (rotation)
    revokeRefreshToken(this.db, tokenHash);
    revokeApiKey(this.db, row.api_key_id);

    // Use requested scopes if provided and they are a subset of the original
    const originalScopes = row.scopes.split(",");
    const newScopes =
      scopes && scopes.length > 0
        ? scopes.filter((s) => originalScopes.includes(s))
        : originalScopes;
    const scopesStr = serializeScopes(newScopes as Parameters<typeof serializeScopes>[0]);

    // Issue new access token
    const material = createApiKeyMaterial();
    const expiresAt = new Date(
      Date.now() + this.config.accessTokenTtlMinutes * 60 * 1000
    ).toISOString();

    const keyId = createApiKey(this.db, {
      name: `oauth:${client.client_id}:${Date.now()}`,
      keyHash: material.keyHash,
      scopes: scopesStr,
      expiresAt,
      oauthClientId: client.client_id
    });

    // Issue new refresh token
    const newRefreshTokenPlaintext = `lbx_rt_${crypto.randomBytes(32).toString("hex")}`;
    const newRefreshTokenHash = crypto
      .createHash("sha256")
      .update(newRefreshTokenPlaintext)
      .digest("hex");
    const refreshExpiresAt = new Date(
      Date.now() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000
    ).toISOString();

    createRefreshToken(this.db, {
      tokenHash: newRefreshTokenHash,
      clientId: client.client_id,
      apiKeyId: keyId,
      scopes: scopesStr,
      expiresAt: refreshExpiresAt
    });

    return {
      access_token: material.plaintextKey,
      token_type: "bearer",
      expires_in: this.config.accessTokenTtlMinutes * 60,
      refresh_token: newRefreshTokenPlaintext,
      scope: scopesStr.replace(/,/g, " ")
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const keyHash = hashApiKey(token);
    const row = getActiveApiKeyByHash(this.db, keyHash);
    if (!row) {
      throw new Error("Invalid or expired access token");
    }

    const scopes = parseScopes(row.scopes);
    const expiresAt = row.expires_at ? Math.floor(new Date(row.expires_at).getTime() / 1000) : undefined;

    return {
      token,
      clientId: row.oauth_client_id ?? "api-key",
      scopes,
      expiresAt
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    const token = request.token;
    const hint = request.token_type_hint;

    if (hint === "refresh_token" || token.startsWith("lbx_rt_")) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const row = getRefreshTokenByHash(this.db, tokenHash);
      if (row) {
        revokeRefreshToken(this.db, tokenHash);
        revokeApiKey(this.db, row.api_key_id);
      }
      return;
    }

    // Treat as access token
    const keyHash = hashApiKey(token);
    const row = getActiveApiKeyByHash(this.db, keyHash);
    if (row) {
      revokeApiKey(this.db, row.id);
      revokeRefreshTokensByApiKeyId(this.db, row.id);
    }
  }
}
