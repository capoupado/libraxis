import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";

import { createOAuthClient, generateClientId, getOAuthClient } from "../db/queries/oauth-queries.js";

export class LibraxisOAuthClientsStore implements OAuthRegisteredClientsStore {
  constructor(private readonly db: Database.Database) {}

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = getOAuthClient(this.db, clientId);
    if (!row) return undefined;

    const metadata = JSON.parse(row.metadata_json) as Omit<
      OAuthClientInformationFull,
      "client_id" | "client_secret" | "client_secret_expires_at" | "client_id_issued_at"
    >;

    return {
      ...metadata,
      client_id: row.client_id,
      client_secret: row.client_secret ?? undefined,
      client_secret_expires_at: row.client_secret_expires_at ?? undefined,
      client_id_issued_at: row.client_id_issued_at
    };
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">
  ): OAuthClientInformationFull {
    const clientId = generateClientId();
    const issuedAt = Math.floor(Date.now() / 1000);

    const fullClient: OAuthClientInformationFull = {
      ...client,
      client_id: clientId,
      client_id_issued_at: issuedAt
    };

    createOAuthClient(this.db, fullClient);
    return fullClient;
  }
}
