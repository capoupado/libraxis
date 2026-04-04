import fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import sensible from "@fastify/sensible";
import formbody from "@fastify/formbody";

import { isDomainError } from "../service/errors.js";
import { registerSecurityMiddleware } from "./middleware/security.js";

export async function buildHttpServer() {
  const app = fastify({ logger: true });

  await app.register(sensible);
  await app.register(cors, { origin: false });
  await app.register(cookie);
  await app.register(formbody);
  await registerSecurityMiddleware(app);

  app.get("/health", async () => ({
    status: "ok"
  }));

  app.setErrorHandler((error, _request, reply) => {
    if (isDomainError(error)) {
      const statusCode =
        error.code === "ENTRY_NOT_FOUND"
          ? 404
          : error.code === "VERSION_CONFLICT"
            ? 409
            : error.code === "CONTENT_LIMIT_EXCEEDED"
              ? 413
              : error.code === "FORBIDDEN"
                ? 403
                : error.code === "AUTH_REQUIRED"
                  ? 401
                  : 400;

      reply.status(statusCode).send({
        error: error.code,
        message: error.message,
        suggestion: error.suggestion
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown error";

    reply.status(500).send({
      error: "INTERNAL_ERROR",
      message
    });
  });

  return app;
}
