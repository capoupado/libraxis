import { describe, expect, it } from "vitest";
import { z } from "zod";

import { DomainError } from "../../src/service/errors.js";
import { toMcpErrorEnvelope } from "../../src/mcp/errors.js";

describe("MCP error envelope mapping", () => {
  it("maps Zod validation failures to INVALID_INPUT", () => {
    const parsed = z
      .object({
        skill_lineage_id: z.string().min(1),
        proposal_markdown: z.string().min(1)
      })
      .safeParse({ proposal_markdown: "Update this skill." });

    expect(parsed.success).toBe(false);

    if (parsed.success) {
      throw new Error("Expected parse failure in test setup");
    }

    const envelope = toMcpErrorEnvelope(parsed.error, {
      toolName: "libraxis_propose_skill_improvement"
    });

    expect(envelope.error).toBe("INVALID_INPUT");
    expect(envelope.message).toContain("skill_lineage_id");
    expect(envelope.suggestion).toContain("libraxis_create_entry");
  });

  it("preserves domain errors", () => {
    const envelope = toMcpErrorEnvelope(
      new DomainError("FORBIDDEN", "Denied", "Use an API key with write scope")
    );

    expect(envelope.error).toBe("FORBIDDEN");
    expect(envelope.message).toBe("Denied");
    expect(envelope.suggestion).toBe("Use an API key with write scope");
  });

  it("suggests create_entry when upload_agent is called without agent intent", () => {
    const parsed = z
      .object({
        agent_intent: z.literal("agent_package"),
        title: z.string().min(1),
        body_markdown: z.string().min(1)
      })
      .safeParse({
        title: "Not an agent",
        body_markdown: "Likely a skill payload"
      });

    expect(parsed.success).toBe(false);

    if (parsed.success) {
      throw new Error("Expected parse failure in test setup");
    }

    const envelope = toMcpErrorEnvelope(parsed.error, {
      toolName: "libraxis_upload_agent"
    });

    expect(envelope.error).toBe("INVALID_INPUT");
    expect(envelope.suggestion).toContain("libraxis_create_entry");
    expect(envelope.suggestion).toContain("agent_intent");
  });
});
