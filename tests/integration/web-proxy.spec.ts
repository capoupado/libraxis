import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("integration: web proxy routing", () => {
  it("proxies agents API routes in dev mode", () => {
    const configPath = path.resolve(process.cwd(), "vite.config.ts");
    const config = fs.readFileSync(configPath, "utf8");

    expect(config).toContain("proposals|agents|owner");
  });
});
