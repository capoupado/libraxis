import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { env } from "../config/env.js";
import { closeDatabaseConnection, getDatabaseConnection } from "../db/connection.js";
import { defaultMigrationsDir, runMigrations } from "../db/migrations/run-migrations.js";
import { DomainError } from "../service/errors.js";
import { createAuthenticatedSdkMcpServer } from "./sdk-server.js";

function getMcpApiKey(): string {
  const value = env.LIBRAXIS_MCP_API_KEY.trim();
  if (value.length === 0) {
    throw new DomainError("AUTH_REQUIRED", "LIBRAXIS_MCP_API_KEY is required for MCP access");
  }
  return value;
}

async function main(): Promise<void> {
  const db = getDatabaseConnection(env.LIBRAXIS_DB_PATH);
  runMigrations(db, defaultMigrationsDir());

  const mcpApiKey = getMcpApiKey();
  const { server: mcpServer, toolCount } = createAuthenticatedSdkMcpServer(db, mcpApiKey);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  process.stderr.write(`Libraxis MCP stdio server ready with ${toolCount} tools.\n`);

  const shutdown = async () => {
    await mcpServer.close();
    closeDatabaseConnection();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`Libraxis MCP startup failed: ${message}\n`);
  closeDatabaseConnection();
  process.exit(1);
});
