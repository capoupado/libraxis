import { describe, expect, it } from "vitest";

import { createEntry } from "../../src/service/entries.js";
import { getContextBundle } from "../../src/service/context.js";
import { createMigratedTestDb, seedUs1Data } from "../helpers/test-db.js";

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

describe("performance: context bundle latency", () => {
  it("asserts p95 context retrieval under 5 seconds", () => {
    const ctx = createMigratedTestDb();

    try {
      seedUs1Data(ctx.db);
      for (let i = 0; i < 300; i += 1) {
        createEntry(ctx.db, {
          type: i % 2 === 0 ? "note" : "prompt",
          title: `Perf seed ${i}`,
          body_markdown: `typescript migration validation seed content ${i}`,
          created_by: "perf"
        });
      }

      const durations: number[] = [];
      for (let i = 0; i < 60; i += 1) {
        const start = performance.now();
        getContextBundle(ctx.db, {
          task_description: "typescript migration validation",
          limit: 20
        });
        durations.push(performance.now() - start);
      }

      const p95 = percentile(durations, 95);
      expect(p95).toBeLessThan(5000);
    } finally {
      ctx.cleanup();
    }
  });
});
