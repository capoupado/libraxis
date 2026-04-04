import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import { getContextBundle } from "../../service/context.js";
import { listSkills, loadSkill } from "../../service/skills.js";

interface ContextQuery {
  task?: string;
  limit?: number;
}

interface SkillListQuery {
  skill_type?: string;
  tags?: string;
  limit?: number;
}

interface SkillLoadParams {
  lineageId: string;
}

export async function registerSkillsRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  app.get<{ Querystring: ContextQuery }>("/context", async (request) => {
    const taskDescription = request.query.task ?? "";
    return getContextBundle(db, {
      task_description: taskDescription,
      limit: request.query.limit
    });
  });

  app.get<{ Querystring: SkillListQuery }>("/skills", async (request) => {
    const tags = request.query.tags
      ? request.query.tags
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter((item) => item.length > 0)
      : undefined;

    return {
      items: listSkills(db, {
        tags,
        skill_type: request.query.skill_type,
        limit: request.query.limit
      }),
      next_cursor: null
    };
  });

  app.get<{ Params: SkillLoadParams }>("/skills/:lineageId/load", async (request) => {
    return loadSkill(db, {
      skill_lineage_id: request.params.lineageId
    });
  });
}
