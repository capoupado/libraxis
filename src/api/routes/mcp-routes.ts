import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { createAuthenticatedSdkMcpServer } from "../../mcp/sdk-server.js";
import { authenticateApiKeyForAnyScope } from "../../service/api-keys.js";
import { DomainError, isDomainError } from "../../service/errors.js";
import { mcpInitializeRequestSchema, parseOrThrow } from "../../service/validation/schemas.js";

interface McpSessionState {
  apiKey: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  isDisposing: boolean;
}

function toStatusCode(error: DomainError): number {
  if (error.code === "ENTRY_NOT_FOUND") {
    return 404;
  }

  if (error.code === "FORBIDDEN") {
    return 403;
  }

  if (error.code === "AUTH_REQUIRED") {
    return 401;
  }

  return 400;
}

function sendHttpError(reply: FastifyReply, error: unknown): void {
  if (isDomainError(error)) {
    reply.status(toStatusCode(error)).send({
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
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function getSessionId(request: FastifyRequest): string | undefined {
  const raw = firstHeaderValue(request.headers["mcp-session-id"]);
  const value = raw?.trim();
  return value && value.length > 0 ? value : undefined;
}

function extractApiKey(request: FastifyRequest): string {
  const bearerHeader = firstHeaderValue(request.headers.authorization);
  if (bearerHeader) {
    const [scheme, token] = bearerHeader.split(" ");
    if (scheme?.toLowerCase() === "bearer" && token && token.trim().length > 0) {
      return token.trim();
    }
  }

  const xApiKeyHeader = firstHeaderValue(request.headers["x-api-key"]);
  if (xApiKeyHeader && xApiKeyHeader.trim().length > 0) {
    return xApiKeyHeader.trim();
  }

  throw new DomainError(
    "AUTH_REQUIRED",
    "Provide API key using Authorization: Bearer <key> or x-api-key header"
  );
}

function assertInitializeRequest(body: unknown): void {
  if (Array.isArray(body)) {
    throw new DomainError("INVALID_INPUT", "Initial MCP request must be a single initialize request");
  }

  parseOrThrow(mcpInitializeRequestSchema, body, "Invalid MCP initialize request");
}

export async function registerMcpRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  const sessions = new Map<string, McpSessionState>();

  const disposeSession = async (sessionId: string): Promise<void> => {
    const state = sessions.get(sessionId);
    if (!state || state.isDisposing) {
      return;
    }

    state.isDisposing = true;
    sessions.delete(sessionId);

    // Prevent reentrant cleanup when server.close() closes the transport.
    state.transport.onclose = undefined;
    await state.server.close();
  };

  app.addHook("onClose", async () => {
    for (const sessionId of Array.from(sessions.keys())) {
      await disposeSession(sessionId);
    }
  });

  app.post("/mcp", async (request, reply) => {
    try {
      const sessionId = getSessionId(request);

      if (sessionId) {
        const state = sessions.get(sessionId);
        if (!state) {
          throw new DomainError("ENTRY_NOT_FOUND", "MCP session not found");
        }

        const apiKey = extractApiKey(request);
        authenticateApiKeyForAnyScope(db, apiKey);

        if (apiKey !== state.apiKey) {
          throw new DomainError("FORBIDDEN", "API key does not match active MCP session");
        }

        reply.hijack();
        await state.transport.handleRequest(request.raw, reply.raw, request.body);
        return;
      }

      assertInitializeRequest(request.body);

      const apiKey = extractApiKey(request);
      authenticateApiKeyForAnyScope(db, apiKey);

      const { server } = createAuthenticatedSdkMcpServer(db, apiKey);
      let transport: StreamableHTTPServerTransport;

      try {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            sessions.set(initializedSessionId, {
              apiKey,
              server,
              transport,
              isDisposing: false
            });
          }
        });

        transport.onclose = () => {
          const activeSessionId = transport.sessionId;
          if (activeSessionId) {
            void disposeSession(activeSessionId);
          }
        };

        await server.connect(transport);

        reply.hijack();
        await transport.handleRequest(request.raw, reply.raw, request.body);

        // If initialize failed before establishing a session, close this temporary server.
        if (!transport.sessionId) {
          await server.close();
        }
      } catch (error) {
        await server.close();
        throw error;
      }
    } catch (error) {
      if (!reply.raw.headersSent) {
        sendHttpError(reply, error);
      }
    }
  });

  app.get("/mcp", async (request, reply) => {
    try {
      const sessionId = getSessionId(request);
      if (!sessionId) {
        throw new DomainError("INVALID_INPUT", "Missing mcp-session-id header");
      }

      const state = sessions.get(sessionId);
      if (!state) {
        throw new DomainError("ENTRY_NOT_FOUND", "MCP session not found");
      }

      const apiKey = extractApiKey(request);
      authenticateApiKeyForAnyScope(db, apiKey);

      if (apiKey !== state.apiKey) {
        throw new DomainError("FORBIDDEN", "API key does not match active MCP session");
      }

      reply.hijack();
      await state.transport.handleRequest(request.raw, reply.raw);
    } catch (error) {
      if (!reply.raw.headersSent) {
        sendHttpError(reply, error);
      }
    }
  });

  app.delete("/mcp", async (request, reply) => {
    try {
      const sessionId = getSessionId(request);
      if (!sessionId) {
        throw new DomainError("INVALID_INPUT", "Missing mcp-session-id header");
      }

      const state = sessions.get(sessionId);
      if (!state) {
        throw new DomainError("ENTRY_NOT_FOUND", "MCP session not found");
      }

      const apiKey = extractApiKey(request);
      authenticateApiKeyForAnyScope(db, apiKey);

      if (apiKey !== state.apiKey) {
        throw new DomainError("FORBIDDEN", "API key does not match active MCP session");
      }

      reply.hijack();
      await state.transport.handleRequest(request.raw, reply.raw);
    } catch (error) {
      if (!reply.raw.headersSent) {
        sendHttpError(reply, error);
      }
    }
  });
}