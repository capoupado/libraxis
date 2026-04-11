import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readStyles(): string {
  const stylesPath = path.resolve(process.cwd(), "src/web/styles.css");
  return fs.readFileSync(stylesPath, "utf8");
}

describe("integration: web style guardrails", () => {
  it("includes reduced motion guardrails", () => {
    const css = readStyles();

    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation: none !important");
  });

  it("includes responsive overflow guardrails for markdown and tables", () => {
    const css = readStyles();

    expect(css).toContain(".table-scroll");
    expect(css).toContain(".proposal-markdown");
    expect(css).toContain(".markdown-content");
  });

  it("includes mobile layout adjustments for shell and input groups", () => {
    const css = readStyles();

    expect(css).toContain("@media (max-width: 640px)");
    expect(css).toContain(".cyber-input");
    expect(css).toContain(".cyber-input__prefix");
  });
});
