import { useEffect, useState } from "react";

import { fetchJson, getErrorMessage } from "../lib/http-client.js";

interface AgentListItem {
  entry_id: string;
  lineage_id: string;
  title: string;
  tags: string[];
  skill_type: string;
  latest_version: number;
}

interface AgentLoadResult {
  skill: {
    lineage_id: string;
    title: string;
    body_markdown: string;
    metadata: Record<string, unknown>;
  };
  resolved_sub_skills: unknown[];
  related_mistakes: unknown[];
  related_lessons: unknown[];
}

export interface AgentsPageProps {
  csrfToken: string;
}

export function AgentsPage({ csrfToken }: AgentsPageProps) {
  const [title, setTitle] = useState("My Portable Agent");
  const [bodyMarkdown, setBodyMarkdown] = useState("Describe your agent behavior and reusable instructions.");
  const [tagInput, setTagInput] = useState("agent,portable");
  const [metadataJson, setMetadataJson] = useState('{"agent_version":"1.0.0","runtime":"mcp"}');
  const [items, setItems] = useState<AgentListItem[]>([]);
  const [feedback, setFeedback] = useState<string>("");
  const [loadDetails, setLoadDetails] = useState<AgentLoadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingAgentId, setLoadingAgentId] = useState<string | null>(null);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const payload = await fetchJson<{ items: AgentListItem[] }>(
      "/agents",
      {},
      "Failed to load agents."
    );

    setItems(payload.items ?? []);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        await refresh();
      } catch (caught) {
        setError(getErrorMessage(caught, "Failed to load agents."));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  return (
    <section>
      <h2>Upload Agent</h2>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setFeedback("");
          setError(null);
          setSubmitting(true);

          let metadata: Record<string, unknown>;
          try {
            metadata = JSON.parse(metadataJson) as Record<string, unknown>;
          } catch {
            setFeedback("Metadata JSON must be valid.");
            setSubmitting(false);
            return;
          }

          try {
            const payload = await fetchJson<{ lineage_id: string; version_number: number }>(
              "/owner/agents",
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-csrf-token": csrfToken
                },
                body: JSON.stringify({
                  title,
                  body_markdown: bodyMarkdown,
                  tags: tagInput
                    .split(",")
                    .map((tag) => tag.trim().toLowerCase())
                    .filter(Boolean),
                  metadata
                })
              },
              "Failed to upload agent."
            );

            setFeedback(`Agent uploaded: ${payload.lineage_id} (v${payload.version_number})`);
            await refresh();
          } catch (caught) {
            setError(getErrorMessage(caught, "Failed to upload agent."));
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <label>
          Agent Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>

        <label>
          Tags (comma-separated)
          <input value={tagInput} onChange={(event) => setTagInput(event.target.value)} />
        </label>

        <label>
          Agent Instructions (Markdown)
          <textarea
            rows={10}
            value={bodyMarkdown}
            onChange={(event) => setBodyMarkdown(event.target.value)}
          />
        </label>

        <label>
          Metadata JSON
          <textarea
            rows={6}
            value={metadataJson}
            onChange={(event) => setMetadataJson(event.target.value)}
          />
        </label>

        <button type="submit" disabled={submitting}>
          {submitting ? "Uploading..." : "Upload Agent"}
        </button>
      </form>

      {loading ? <p role="status">Loading agents...</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {feedback ? <p role="status">{feedback}</p> : null}

      <h3>Uploaded Agents</h3>
      {!loading && items.length === 0 ? <p>No uploaded agents found.</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.entry_id}>
            <div>
              <button
                type="button"
                disabled={loadingAgentId === item.lineage_id}
                onClick={async () => {
                  setLoadingAgentId(item.lineage_id);
                  setError(null);
                  try {
                    const payload = await fetchJson<AgentLoadResult>(
                      `/agents/${item.lineage_id}/load`,
                      {},
                      "Failed to load agent details."
                    );
                    setLoadDetails(payload);
                  } catch (caught) {
                    setError(getErrorMessage(caught, "Failed to load agent details."));
                  } finally {
                    setLoadingAgentId(null);
                  }
                }}
              >
                {loadingAgentId === item.lineage_id
                  ? "Loading..."
                  : `${item.title} [${item.tags.join(",")}] v${item.latest_version}`}
              </button>

              <button
                type="button"
                className="error"
                disabled={deletingAgentId === item.lineage_id}
                onClick={async () => {
                  if (!window.confirm(`Archive agent \"${item.title}\"?`)) {
                    return;
                  }

                  setDeletingAgentId(item.lineage_id);
                  setError(null);
                  setFeedback("");

                  try {
                    await fetchJson<{ lineage_id: string; status: "archived" }>(
                      `/owner/agents/${item.lineage_id}`,
                      {
                        method: "DELETE",
                        headers: {
                          "x-csrf-token": csrfToken
                        }
                      },
                      "Failed to delete agent."
                    );

                    if (loadDetails?.skill.lineage_id === item.lineage_id) {
                      setLoadDetails(null);
                    }

                    await refresh();
                    setFeedback(`Agent archived: ${item.title}`);
                  } catch (caught) {
                    setError(getErrorMessage(caught, "Failed to delete agent."));
                  } finally {
                    setDeletingAgentId(null);
                  }
                }}
              >
                {deletingAgentId === item.lineage_id ? "Deleting..." : "Delete"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {loadDetails ? (
        <section>
          <h3>Selected Agent</h3>
          <p>{loadDetails.skill.title}</p>
          <h4>Description</h4>
          <pre className="proposal-markdown">{loadDetails.skill.body_markdown}</pre>
        </section>
      ) : null}
    </section>
  );
}
