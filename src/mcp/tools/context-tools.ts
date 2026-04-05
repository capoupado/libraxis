import type Database from "better-sqlite3";
import { z } from "zod";

import type { BaseMcpServer } from "../server.js";
import { getContextBundle } from "../../service/context.js";
import { listSkills, loadSkill } from "../../service/skills.js";

const allEntryTypes = z.enum([
  "prompt", "run", "mistake", "lesson", "note", "skill",
  "user", "feedback", "project", "reference"
]);

const getContextInputSchema = z.object({
  task_description: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
  include_types: z.array(allEntryTypes).optional()
});

const getBriefingInputSchema = z.object({
  limit: z.number().int().min(1).max(20).optional()
});

const listSkillsInputSchema = z.object({
  tags: z.array(z.string().min(1)).optional(),
  skill_type: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional()
});

const loadSkillInputSchema = z
  .object({
    skill_lineage_id: z.string().min(1).optional(),
    skill_entry_id: z.string().min(1).optional()
  })
  .refine((value) => Boolean(value.skill_lineage_id || value.skill_entry_id), {
    message: "Either skill_lineage_id or skill_entry_id is required"
  });

export function registerContextTools(server: BaseMcpServer, db: Database.Database): void {
  server.registerTool("libraxis_get_context", async (input) => {
    const parsed = getContextInputSchema.parse(input);
    return getContextBundle(db, parsed);
  });

  server.registerTool("libraxis_get_agent_briefing", async (input) => {
    const parsed = getBriefingInputSchema.parse(input ?? {});
    return getContextBundle(db, {
      task_description: " ",
      include_types: ["user", "feedback", "project"],
      limit: parsed.limit ?? 10
    });
  });

  server.registerTool("libraxis_list_skills", async (input) => {
    const parsed = listSkillsInputSchema.parse(input ?? {});
    return {
      items: listSkills(db, parsed),
      next_cursor: null
    };
  });

  server.registerTool("libraxis_load_skill", async (input) => {
    const parsed = loadSkillInputSchema.parse(input);
    return loadSkill(db, parsed);
  });
}
