import crypto from "node:crypto";

export interface OwnerSession {
  id: string;
  ownerUsername: string;
  issuedAt: string;
  expiresAt: string;
  csrfToken: string;
}

export function createSessionTokens(): { sessionId: string; csrfToken: string } {
  return {
    sessionId: crypto.randomBytes(32).toString("hex"),
    csrfToken: crypto.randomBytes(24).toString("hex")
  };
}

export function buildSession(ownerUsername: string, ttlDays: number): OwnerSession {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  const { sessionId, csrfToken } = createSessionTokens();

  return {
    id: sessionId,
    ownerUsername,
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    csrfToken
  };
}

export function isExpired(expiresAtIso: string, now = new Date()): boolean {
  return new Date(expiresAtIso).getTime() <= now.getTime();
}
