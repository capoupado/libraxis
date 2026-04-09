-- OAuth 2.0 Dynamic Client Registration (RFC 7591)
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret TEXT,
  client_secret_expires_at INTEGER,
  client_id_issued_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- OAuth 2.0 Authorization Codes (short-lived, one-time use, PKCE)
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK(used IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS ix_oauth_codes_client ON oauth_authorization_codes(client_id);

-- OAuth 2.0 Refresh Tokens (reference api_keys for the associated access token)
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  api_key_id TEXT NOT NULL REFERENCES api_keys(id),
  scopes TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  is_revoked INTEGER NOT NULL DEFAULT 0 CHECK(is_revoked IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS ix_oauth_refresh_client ON oauth_refresh_tokens(client_id);

-- Extend api_keys to support OAuth token expiry and client association
ALTER TABLE api_keys ADD COLUMN expires_at TEXT;
ALTER TABLE api_keys ADD COLUMN oauth_client_id TEXT;
