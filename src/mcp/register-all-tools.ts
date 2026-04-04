import type Database from "better-sqlite3";

import type { BaseMcpServer } from "./server.js";
import { registerAdminTools } from "./tools/admin-tools.js";
import { registerAgentTools } from "./tools/agent-tools.js";
import { registerContextTools } from "./tools/context-tools.js";
import { registerEntryTools } from "./tools/entry-tools.js";
import { registerProposalTools } from "./tools/proposal-tools.js";

export function registerAllMcpTools(server: BaseMcpServer, db: Database.Database): void {
  registerContextTools(server, db);
  registerAgentTools(server, db);
  registerEntryTools(server, db);
  registerProposalTools(server, db);
  registerAdminTools(server, db);
}
