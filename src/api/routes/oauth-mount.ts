import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import "@fastify/express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";

import { env } from "../../config/env.js";
import { LibraxisOAuthProvider } from "../../auth/oauth-provider.js";
import { registerOAuthConsentRoutes } from "./oauth-routes.js";

export async function registerOAuthRoutes(
  app: FastifyInstance,
  db: Database.Database
): Promise<void> {
  const publicUrl = env.LIBRAXIS_PUBLIC_URL;
  const issuerUrl = new URL(publicUrl);

  // Fix: express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR when behind
  // a proxy (Apache sets X-Forwarded-For) unless Express trusts the proxy.
  app.express.set("trust proxy", 1);

  const provider = new LibraxisOAuthProvider(db, {
    accessTokenTtlMinutes: env.LIBRAXIS_OAUTH_ACCESS_TOKEN_TTL_MINUTES,
    refreshTokenTtlDays: env.LIBRAXIS_OAUTH_REFRESH_TOKEN_TTL_DAYS,
    codeTtlSeconds: env.LIBRAXIS_OAUTH_CODE_TTL_SECONDS,
    publicUrl
  });

  // Mount the SDK's Express-based OAuth metadata + token + registration + revocation routes
  // via @fastify/express bridge. Must be at application root per SDK docs.
  const authRouter = mcpAuthRouter({
    provider,
    issuerUrl,
    // resourceServerUrl must include /mcp so the SDK registers the protected resource
    // metadata at /.well-known/oauth-protected-resource/mcp (not just /)
    resourceServerUrl: new URL(`${publicUrl}/mcp`),
    scopesSupported: ["read", "write", "admin"],
    resourceName: "Libraxis"
  });

  // @fastify/express adds app.use() support
  (app as unknown as { use: (handler: unknown) => void }).use(authRouter);

  // Register our consent UI (Fastify-native routes)
  await registerOAuthConsentRoutes(app, db, provider);
}
