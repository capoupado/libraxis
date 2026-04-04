import { ZodError } from "zod";

import { DomainError, isDomainError } from "../service/errors.js";

export interface McpErrorEnvelope {
  error: string;
  message: string;
  suggestion?: string;
}

interface McpErrorContext {
  toolName?: string;
}

const NEW_SKILL_CREATION_HINT =
  "If you are creating a new skill, call libraxis_create_entry with type=\"skill\" plus title and body_markdown. lineage_id is only required for existing skill or entry lineages.";

const AGENT_UPLOAD_INTENT_HINT =
  "libraxis_upload_agent is only for reusable agents and requires agent_intent=\"agent_package\". If you are creating a skill, call libraxis_create_entry with type=\"skill\".";

function formatZodIssueSummary(error: ZodError): string {
  const formatted = error.issues.slice(0, 3).map((issue) => {
    const path = issue.path.join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });

  const overflowCount = error.issues.length - formatted.length;
  if (overflowCount > 0) {
    formatted.push(`+${overflowCount} more issue(s)`);
  }

  return formatted.join("; ");
}

function hasLineageValidationIssue(error: ZodError): boolean {
  return error.issues.some((issue) => {
    const issuePath = issue.path.join(".").toLowerCase();
    return issuePath.includes("lineage") || issue.message.toLowerCase().includes("lineage");
  });
}

function hasAgentIntentValidationIssue(error: ZodError): boolean {
  return error.issues.some((issue) => {
    const issuePath = issue.path.join(".").toLowerCase();
    const message = issue.message.toLowerCase();
    return issuePath.includes("agent_intent") || message.includes("agent_intent");
  });
}

function buildZodSuggestion(error: ZodError, context?: McpErrorContext): string | undefined {
  const toolName = context?.toolName;
  const lineageIssue = hasLineageValidationIssue(error);
  const agentIntentIssue = hasAgentIntentValidationIssue(error);

  if (toolName === "libraxis_upload_agent" && agentIntentIssue) {
    return AGENT_UPLOAD_INTENT_HINT;
  }

  if (!lineageIssue) {
    return undefined;
  }

  if (
    toolName === "libraxis_update_entry" ||
    toolName === "libraxis_propose_skill_improvement" ||
    toolName === "libraxis_load_skill" ||
    toolName === "libraxis_export_entry_markdown" ||
    toolName === undefined
  ) {
    return NEW_SKILL_CREATION_HINT;
  }

  return undefined;
}

export function toMcpErrorEnvelope(error: unknown, context?: McpErrorContext): McpErrorEnvelope {
  if (isDomainError(error)) {
    return {
      error: error.code,
      message: error.message,
      suggestion: error.suggestion
    };
  }

  if (error instanceof ZodError) {
    const toolHint = context?.toolName ? ` for ${context.toolName}` : "";
    return {
      error: "INVALID_INPUT",
      message: `Invalid input${toolHint}: ${formatZodIssueSummary(error)}`,
      suggestion: buildZodSuggestion(error, context)
    };
  }

  if (error instanceof Error) {
    return {
      error: "INTERNAL_ERROR",
      message: error.message
    };
  }

  return {
    error: "INTERNAL_ERROR",
    message: "Unknown error"
  };
}

export function asDomainError(code: DomainError["code"], message: string): DomainError {
  return new DomainError(code, message);
}
