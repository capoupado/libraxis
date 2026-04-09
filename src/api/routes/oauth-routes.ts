import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import { env } from "../../config/env.js";
import type { LibraxisOAuthProvider } from "../../auth/oauth-provider.js";
// Note: pending.res (Express Response) is used only in provider.authorize() to redirect
// to the consent page. The POST handler uses Fastify reply for the final redirect.
import { createAuthorizationCode } from "../../db/queries/oauth-queries.js";
import { buildSession, isExpired } from "../../auth/sessions.js";
import { createWebSession, getWebSession } from "../../db/queries/auth-queries.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function renderPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Libraxis</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f0f0f;
      color: #e8e8e8;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 2rem;
      width: 100%;
      max-width: 400px;
    }
    .logo {
      font-size: 1.25rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 1.5rem;
      letter-spacing: -0.02em;
    }
    h1 {
      font-size: 1.1rem;
      font-weight: 600;
      color: #fff;
      margin-bottom: 0.5rem;
    }
    p { font-size: 0.875rem; color: #888; margin-bottom: 1.5rem; line-height: 1.5; }
    label { display: block; font-size: 0.8rem; color: #aaa; margin-bottom: 0.25rem; }
    input[type="text"], input[type="password"] {
      width: 100%;
      background: #111;
      border: 1px solid #333;
      border-radius: 6px;
      color: #e8e8e8;
      font-size: 0.875rem;
      padding: 0.5rem 0.75rem;
      margin-bottom: 1rem;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: #555; }
    .btn-row { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
    button {
      flex: 1;
      border: none;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      padding: 0.6rem 1rem;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    button:hover { opacity: 0.85; }
    .btn-primary { background: #fff; color: #000; }
    .btn-danger { background: #3a1a1a; color: #f87171; border: 1px solid #5a2a2a; }
    .error {
      background: #3a1a1a;
      border: 1px solid #5a2a2a;
      border-radius: 6px;
      color: #f87171;
      font-size: 0.8rem;
      padding: 0.5rem 0.75rem;
      margin-bottom: 1rem;
    }
    .scopes {
      background: #111;
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 1.25rem;
    }
    .scope-item {
      font-size: 0.8rem;
      color: #aaa;
      padding: 0.2rem 0;
    }
    .scope-item::before { content: "✓ "; color: #4ade80; }
    .client-name { color: #fff; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Libraxis</div>
    ${body}
  </div>
</body>
</html>`;
}

export async function registerOAuthConsentRoutes(
  app: FastifyInstance,
  db: Database.Database,
  provider: LibraxisOAuthProvider
): Promise<void> {
  // GET /oauth/authorize — show login or consent page
  app.get<{ Querystring: { request_id?: string; client_name?: string; error?: string } }>(
    "/oauth/authorize",
    async (request, reply) => {
      const { request_id, client_name, error } = request.query;

      if (!request_id) {
        reply.status(400).send("Missing request_id");
        return;
      }

      const pending = provider.getPendingRequest(request_id);
      if (!pending) {
        reply.status(400).type("text/html").send(
          renderPage(
            "Authorization Error",
            `<h1>Request Expired</h1><p>This authorization request has expired or is invalid. Please try connecting again.</p>`
          )
        );
        return;
      }

      // Check if owner already has a valid session
      const sessionId = request.cookies.lbx_session;
      const session = sessionId ? getWebSession(db, sessionId) : undefined;
      const isAuthenticated = session && !isExpired(session.expires_at);

      const safeClientName = escapeHtml(client_name ?? pending.clientId);
      const errorHtml = error
        ? `<div class="error">${escapeHtml(error)}</div>`
        : "";

      const requestedScopes = pending.params.scopes ?? ["read", "write"];
      const scopeItems = requestedScopes
        .map((s) => `<div class="scope-item">${escapeHtml(s)}</div>`)
        .join("");

      if (isAuthenticated) {
        // Show consent form
        const html = renderPage(
          "Authorize Access",
          `<h1>Authorize Access</h1>
          <p><span class="client-name">${safeClientName}</span> is requesting access to your Libraxis knowledge base.</p>
          ${errorHtml}
          <div class="scopes">${scopeItems}</div>
          <form method="POST" action="/oauth/authorize">
            <input type="hidden" name="request_id" value="${escapeHtml(request_id)}">
            <input type="hidden" name="action" value="approve">
            <div class="btn-row">
              <button type="submit" name="action" value="deny" class="btn-danger">Deny</button>
              <button type="submit" name="action" value="approve" class="btn-primary">Authorize</button>
            </div>
          </form>`
        );
        reply.type("text/html").send(html);
      } else {
        // Show login + consent form
        const html = renderPage(
          "Sign In to Authorize",
          `<h1>Sign In to Authorize</h1>
          <p>Sign in as the owner to grant <span class="client-name">${safeClientName}</span> access to Libraxis.</p>
          ${errorHtml}
          <form method="POST" action="/oauth/authorize">
            <input type="hidden" name="request_id" value="${escapeHtml(request_id)}">
            <input type="hidden" name="action" value="approve">
            <label for="username">Username</label>
            <input type="text" id="username" name="username" autocomplete="username" required>
            <label for="password">Password</label>
            <input type="password" id="password" name="password" autocomplete="current-password" required>
            <div class="btn-row">
              <button type="submit" name="action" value="deny" class="btn-danger">Deny</button>
              <button type="submit" name="action" value="approve" class="btn-primary">Sign In &amp; Authorize</button>
            </div>
          </form>`
        );
        reply.type("text/html").send(html);
      }
    }
  );

  // POST /oauth/authorize — process consent form
  app.post<{
    Body: {
      request_id?: string;
      action?: string;
      username?: string;
      password?: string;
    };
  }>("/oauth/authorize", async (request, reply) => {
    const { request_id, action, username, password } = request.body ?? {};

    if (!request_id) {
      reply.status(400).send("Missing request_id");
      return;
    }

    const pending = provider.getPendingRequest(request_id);
    if (!pending) {
      reply.status(400).type("text/html").send(
        renderPage(
          "Authorization Error",
          `<h1>Request Expired</h1><p>This authorization request has expired. Please try connecting again.</p>`
        )
      );
      return;
    }

    // If denied, redirect with error
    if (action === "deny") {
      provider.deletePendingRequest(request_id);
      const redirectUri = new URL(pending.params.redirectUri);
      redirectUri.searchParams.set("error", "access_denied");
      if (pending.params.state) {
        redirectUri.searchParams.set("state", pending.params.state);
      }
      reply.redirect(redirectUri.toString());
      return;
    }

    // Validate owner session or credentials
    const sessionId = request.cookies.lbx_session;
    const existingSession = sessionId ? getWebSession(db, sessionId) : undefined;
    const isAuthenticated = existingSession && !isExpired(existingSession.expires_at);

    if (!isAuthenticated) {
      // Validate submitted credentials
      if (
        username !== env.LIBRAXIS_ADMIN_USERNAME ||
        password !== env.LIBRAXIS_ADMIN_PASSWORD
      ) {
        const redirectBack = `/oauth/authorize?request_id=${encodeURIComponent(request_id)}&error=${encodeURIComponent("Invalid credentials")}&client_name=${encodeURIComponent(pending.clientId)}`;
        reply.redirect(redirectBack);
        return;
      }

      // Create a new session for the owner
      const session = buildSession(env.LIBRAXIS_ADMIN_USERNAME, env.LIBRAXIS_SESSION_TTL_DAYS);
      createWebSession(db, {
        id: session.id,
        owner_username: session.ownerUsername,
        issued_at: session.issuedAt,
        expires_at: session.expiresAt,
        csrf_token: session.csrfToken
      });

      reply.setCookie("lbx_session", session.id, {
        httpOnly: true,
        sameSite: "lax",
        secure: env.LIBRAXIS_COOKIE_SECURE,
        path: "/"
      });
    }

    // Issue authorization code
    const code = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(
      Date.now() + provider["config"].codeTtlSeconds * 1000
    ).toISOString();

    const requestedScopes = pending.params.scopes ?? ["read", "write"];

    createAuthorizationCode(db, {
      code,
      clientId: pending.clientId,
      redirectUri: pending.params.redirectUri,
      codeChallenge: pending.params.codeChallenge,
      scopes: requestedScopes.join(","),
      expiresAt
    });

    provider.deletePendingRequest(request_id);

    const redirectUri = new URL(pending.params.redirectUri);
    redirectUri.searchParams.set("code", code);
    if (pending.params.state) {
      redirectUri.searchParams.set("state", pending.params.state);
    }

    reply.redirect(redirectUri.toString());
  });
}
