import crypto from "node:crypto";

export type ApiKeyScope = "read" | "write" | "admin";

export interface ApiKeyMaterial {
  plaintextKey: string;
  keyHash: string;
}

export function hashApiKey(plaintextKey: string): string {
  return crypto.createHash("sha256").update(plaintextKey, "utf8").digest("hex");
}

export function createApiKeyMaterial(): ApiKeyMaterial {
  const plaintextKey = `lbx_${crypto.randomBytes(24).toString("hex")}`;
  return {
    plaintextKey,
    keyHash: hashApiKey(plaintextKey)
  };
}

export function serializeScopes(scopes: ApiKeyScope[]): string {
  const normalized = Array.from(new Set(scopes)).sort();
  return normalized.join(",");
}

export function parseScopes(scopes: string): ApiKeyScope[] {
  return scopes
    .split(",")
    .map((scope) => scope.trim())
    .filter(
      (scope): scope is ApiKeyScope =>
        scope === "read" || scope === "write" || scope === "admin"
    );
}

export function isApiKeyMatch(plaintextKey: string, keyHash: string): boolean {
  const computed = hashApiKey(plaintextKey);
  return crypto.timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(keyHash, "utf8"));
}
