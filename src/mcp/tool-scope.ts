import type { ApiKeyScope } from "../auth/api-keys.js";
import { DomainError } from "../service/errors.js";

export const MCP_TOOL_SCOPE: Record<string, ApiKeyScope> = {
  libraxis_get_agent_briefing: "read",
  libraxis_get_context: "read",
  libraxis_list_skills: "read",
  libraxis_load_skill: "read",
  libraxis_create_entry: "write",
  libraxis_update_entry: "write",
  libraxis_log_mistake_with_lesson: "write",
  libraxis_link_entries: "write",
  libraxis_propose_skill_improvement: "write",
  libraxis_list_skill_proposals: "admin",
  libraxis_review_skill_proposal: "admin",
  libraxis_skill_dashboard: "admin",
  libraxis_api_key_create: "admin",
  libraxis_api_key_list: "admin",
  libraxis_api_key_revoke: "admin",
  libraxis_export_entry_markdown: "read",
  libraxis_upload_agent: "write",
  libraxis_list_agents: "read",
  libraxis_load_agent: "read",
  libraxis_get_entry: "read",
  libraxis_list_related: "read",
  libraxis_search_entries: "read",
  libraxis_list_suggested_links: "read",
  libraxis_promote_suggested_link: "write"
};

export function getRequiredScope(toolName: string): ApiKeyScope {
  const scope = MCP_TOOL_SCOPE[toolName];
  if (!scope) {
    throw new DomainError("FORBIDDEN", `No API key scope mapping defined for tool: ${toolName}`);
  }

  return scope;
}