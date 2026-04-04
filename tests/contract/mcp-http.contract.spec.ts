import type { FastifyInstance } from "fastify";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildHttpServer } from "../../src/api/server.js";
import { registerMcpRoutes } from "../../src/api/routes/mcp-routes.js";
import { createMachineApiKey } from "../../src/service/api-keys.js";
import { createMigratedTestDb, type TestDbContext } from "../helpers/test-db.js";

function initializePayload() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: {
        name: "contract-test",
        version: "1.0.0"
      }
    }
  };
}

describe("HTTP contract: MCP streamable endpoint", () => {
  let ctx: TestDbContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    ctx = createMigratedTestDb();
    app = await buildHttpServer();
    await registerMcpRoutes(app, ctx.db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    ctx.cleanup();
  });

  it("requires initialize for requests that do not provide a session", async () => {
    const response = await request(app.server).post("/mcp").send({
      jsonrpc: "2.0",
      id: 2,
      method: "ping"
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("INVALID_INPUT");
  });

  it("rejects malformed initialize payloads", async () => {
    const key = createMachineApiKey(ctx.db, {
      name: "mcp-invalid-initialize",
      scopes: ["read"]
    }).plaintext_key;

    const missingParams = await request(app.server)
      .post("/mcp")
      .set("x-api-key", key)
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize"
      });

    expect(missingParams.status).toBe(400);
    expect(missingParams.body.error).toBe("INVALID_INPUT");

    const invalidClientInfo = await request(app.server)
      .post("/mcp")
      .set("x-api-key", key)
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: {
            name: 123,
            version: "1.0.0"
          }
        }
      });

    expect(invalidClientInfo.status).toBe(400);
    expect(invalidClientInfo.body.error).toBe("INVALID_INPUT");
  });

  it("requires API key on initialize", async () => {
    const response = await request(app.server)
      .post("/mcp")
      .set("accept", "application/json, text/event-stream")
      .send(initializePayload());

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("AUTH_REQUIRED");
  });

  it("enforces API key matching for existing MCP session traffic", async () => {
    const validKey = createMachineApiKey(ctx.db, {
      name: "mcp-session",
      scopes: ["read", "write"]
    }).plaintext_key;

    const initResponse = await request(app.server)
      .post("/mcp")
      .set("x-api-key", validKey)
      .set("accept", "application/json, text/event-stream")
      .send(initializePayload());

    expect(initResponse.status).toBe(200);

    const sessionId = initResponse.headers["mcp-session-id"];
    expect(typeof sessionId).toBe("string");

    const missingKeyResponse = await request(app.server)
      .post("/mcp")
      .set("mcp-session-id", String(sessionId))
      .send({ jsonrpc: "2.0", id: 3, method: "ping" });

    expect(missingKeyResponse.status).toBe(401);
    expect(missingKeyResponse.body.error).toBe("AUTH_REQUIRED");

    const otherKey = createMachineApiKey(ctx.db, {
      name: "other-session",
      scopes: ["read"]
    }).plaintext_key;

    const wrongKeyResponse = await request(app.server)
      .post("/mcp")
      .set("mcp-session-id", String(sessionId))
      .set("x-api-key", otherKey)
      .send({ jsonrpc: "2.0", id: 4, method: "ping" });

    expect(wrongKeyResponse.status).toBe(403);
    expect(wrongKeyResponse.body.error).toBe("FORBIDDEN");
  });
});