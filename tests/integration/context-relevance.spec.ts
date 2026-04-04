import { describe, expect, it } from "vitest";

import { createEntry } from "../../src/service/entries.js";
import { getContextBundle } from "../../src/service/context.js";
import { createMigratedTestDb } from "../helpers/test-db.js";

describe("relevance: context precision", () => {
  it("achieves Precision@10 >= 0.70 for seeded query set", () => {
    const ctx = createMigratedTestDb();

    try {
      const relevantLineages = new Set<string>();

      for (let i = 0; i < 7; i += 1) {
        const created = createEntry(ctx.db, {
          type: i % 2 === 0 ? "skill" : "lesson",
          title: `TypeScript validation strategy ${i}`,
          body_markdown: "typescript migration validation workflow for context precision",
          metadata: i % 2 === 0 ? { skill_type: "workflow", steps: [] } : {},
          created_by: "relevance"
        });
        relevantLineages.add(created.lineage_id);
      }

      for (let i = 0; i < 6; i += 1) {
        createEntry(ctx.db, {
          type: "note",
          title: `Unrelated seed ${i}`,
          body_markdown: "gardening and travel notes unrelated to coding",
          created_by: "relevance"
        });
      }

      const bundle = getContextBundle(ctx.db, {
        task_description: "typescript migration validation",
        limit: 10
      });

      const hits = bundle.results.filter((result) => relevantLineages.has(result.lineage_id)).length;
      const precisionAt10 = hits / 10;

      expect(precisionAt10).toBeGreaterThanOrEqual(0.7);
    } finally {
      ctx.cleanup();
    }
  });
});
