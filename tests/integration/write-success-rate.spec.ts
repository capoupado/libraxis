import { describe, expect, it } from "vitest";

import { createEntry } from "../../src/service/entries.js";
import { createMigratedTestDb } from "../helpers/test-db.js";

describe("reliability: write success rate", () => {
  it("achieves >= 99% success for 500 writes", () => {
    const ctx = createMigratedTestDb();

    try {
      let success = 0;
      const total = 500;

      for (let i = 0; i < total; i += 1) {
        try {
          createEntry(ctx.db, {
            type: "note",
            title: `Write ${i}`,
            body_markdown: `Write body ${i}`,
            created_by: "reliability"
          });
          success += 1;
        } catch {
          // Keep running to measure aggregate success rate.
        }
      }

      const successRate = success / total;
      expect(successRate).toBeGreaterThanOrEqual(0.99);
    } finally {
      ctx.cleanup();
    }
  });
});
