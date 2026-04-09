import { env } from "./config/env.js";
import { buildHttpServer } from "./api/server.js";
import { registerAdminRoutes } from "./api/routes/admin-routes.js";
import { registerAgentsRoutes } from "./api/routes/agents-routes.js";
import { registerEntriesRoutes } from "./api/routes/entries-routes.js";
import { registerMcpRoutes } from "./api/routes/mcp-routes.js";
import { registerOAuthRoutes } from "./api/routes/oauth-mount.js";
import { registerOwnerEntriesRoutes } from "./api/routes/owner-entries-routes.js";
import { registerProposalsRoutes } from "./api/routes/proposals-routes.js";
import { registerSkillsRoutes } from "./api/routes/skills-routes.js";
import { closeDatabaseConnection, getDatabaseConnection } from "./db/connection.js";
import { defaultMigrationsDir, runMigrations } from "./db/migrations/run-migrations.js";

async function main(): Promise<void> {
  const db = getDatabaseConnection(env.LIBRAXIS_DB_PATH);
  runMigrations(db, defaultMigrationsDir());

  const app = await buildHttpServer();

  await registerOAuthRoutes(app, db);
  await registerSkillsRoutes(app, db);
  await registerAgentsRoutes(app, db);
  await registerMcpRoutes(app, db);
  await registerEntriesRoutes(app, db);
  await registerProposalsRoutes(app, db);
  await registerOwnerEntriesRoutes(app, db);
  await registerAdminRoutes(app, db);

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  process.stdout.write(`Libraxis HTTP server listening on http://localhost:${env.PORT}\n`);

  const shutdown = async () => {
    await app.close();
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

void main();