import type Database from "better-sqlite3";
import type { FastifyReply, FastifyRequest } from "fastify";

import { buildSession, isExpired } from "../../auth/sessions.js";
import {
  createWebSession,
  deleteWebSession,
  getWebSession,
  type WebSessionRow
} from "../../db/queries/auth-queries.js";
import { env } from "../../config/env.js";
import { DomainError } from "../../service/errors.js";

export interface OwnerSessionContext {
  session: WebSessionRow;
}

export function loginOwner(
  db: Database.Database,
  username: string,
  password: string
): OwnerSessionContext {
  if (username !== env.LIBRAXIS_ADMIN_USERNAME || password !== env.LIBRAXIS_ADMIN_PASSWORD) {
    throw new DomainError("FORBIDDEN", "Invalid owner credentials");
  }

  const session = buildSession(env.LIBRAXIS_ADMIN_USERNAME, env.LIBRAXIS_SESSION_TTL_DAYS);
  createWebSession(db, {
    id: session.id,
    owner_username: session.ownerUsername,
    issued_at: session.issuedAt,
    expires_at: session.expiresAt,
    csrf_token: session.csrfToken
  });

  return { session: getWebSession(db, session.id)! };
}

export function logoutOwner(db: Database.Database, sessionId: string): void {
  deleteWebSession(db, sessionId);
}

export function requireOwnerSession(
  request: FastifyRequest,
  _reply: FastifyReply,
  db: Database.Database
): OwnerSessionContext {
  const sessionId = request.cookies.lbx_session;
  if (!sessionId) {
    throw new DomainError("AUTH_REQUIRED", "Owner session cookie is missing");
  }

  const session = getWebSession(db, sessionId);
  if (!session) {
    throw new DomainError("AUTH_REQUIRED", "Owner session is invalid");
  }

  if (isExpired(session.expires_at)) {
    deleteWebSession(db, session.id);
    throw new DomainError("AUTH_REQUIRED", "Owner session has expired");
  }

  return { session };
}

export function enforceCsrf(request: FastifyRequest, session: WebSessionRow): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return;
  }

  const csrfHeader = request.headers["x-csrf-token"];
  if (typeof csrfHeader !== "string" || csrfHeader !== session.csrf_token) {
    throw new DomainError("FORBIDDEN", "CSRF token validation failed");
  }
}
