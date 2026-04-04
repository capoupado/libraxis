import type Database from "better-sqlite3";
import { z } from "zod";

import type { BaseMcpServer } from "../server.js";
import { createMachineApiKey, listMachineApiKeys, revokeMachineApiKey } from "../../service/api-keys.js";
import { exportEntryMarkdown } from "../../service/export.js";

const createApiKeySchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.enum(["read", "write", "admin"]))
});

const revokeSchema = z.object({
  key_id: z.string().min(1)
});

const exportSchema = z
  .object({
    entry_id: z.string().optional(),
    lineage_id: z.string().optional()
  })
  .refine((value) => Boolean(value.entry_id || value.lineage_id), {
    message: "entry_id or lineage_id is required"
  });

export function registerAdminTools(server: BaseMcpServer, db: Database.Database): void {
  server.registerTool("libraxis_api_key_create", async (input) => {
    const parsed = createApiKeySchema.parse(input);
    return createMachineApiKey(db, parsed);
  });

  server.registerTool("libraxis_api_key_list", async () => ({
    keys: listMachineApiKeys(db)
  }));

  server.registerTool("libraxis_api_key_revoke", async (input) => {
    const parsed = revokeSchema.parse(input);
    return revokeMachineApiKey(db, parsed.key_id);
  });

  server.registerTool("libraxis_export_entry_markdown", async (input) => {
    const parsed = exportSchema.parse(input);
    return exportEntryMarkdown(db, parsed);
  });
}
