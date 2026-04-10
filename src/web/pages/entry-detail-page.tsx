import { useEffect, useState } from "react";

import { EntryEditor } from "../components/entry-editor.js";
import { MarkdownView } from "../components/markdown-view.js";
import { fetchJson, getErrorMessage } from "../lib/http-client.js";

interface EntryVersion {
  id: string;
  version_number: number;
  title: string;
  body_markdown: string;
  tags: string[];
}

interface BacklinkNode {
  lineage_id: string;
  title: string;
  type: string;
  depth: number;
}

interface SuggestedLink {
  id: string;
  target_lineage_id: string;
  title: string;
  signal: string;
  score: number;
  relation_type: string;
}

const RELATION_TYPES = [
  "relates_to",
  "depends_on",
  "enables",
  "contradicts",
  "refines",
  "exemplifies",
];

function BacklinksSection({
  lineageId,
  onSelectEntry,
}: {
  lineageId: string;
  onSelectEntry: (id: string) => void;
}) {
  const [nodes, setNodes] = useState<BacklinkNode[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    const load = async () => {
      try {
        const data = await fetchJson<{ nodes: BacklinkNode[] }>(
          `/owner/entries/${encodeURIComponent(lineageId)}/graph?signals=explicit&depth=1&direction=in`,
          { signal: controller.signal },
          "Failed to load backlinks."
        );
        if (!controller.signal.aborted) {
          // Exclude the entry itself
          setNodes((data.nodes ?? []).filter((n) => n.lineage_id !== lineageId));
          setLoaded(true);
        }
      } catch {
        if (!controller.signal.aborted) setLoaded(true);
      }
    };
    void load();
    return () => controller.abort();
  }, [lineageId]);

  if (!loaded || nodes.length === 0) return null;

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <h3>Backlinks</h3>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {nodes.map((n) => (
          <li key={n.lineage_id} style={{ marginBottom: "0.4rem" }}>
            <button
              type="button"
              className="cyber-btn cyber-btn--ghost cyber-btn--sm"
              onClick={() => onSelectEntry(n.lineage_id)}
            >
              [{n.type}] {n.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SuggestedLinksSection({
  lineageId,
  csrfToken,
}: {
  lineageId: string;
  csrfToken: string;
}) {
  const [suggestions, setSuggestions] = useState<SuggestedLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [relationTypes, setRelationTypes] = useState<Record<string, string>>({});
  const [promoting, setPromoting] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const loadSuggestions = async (signal?: AbortSignal) => {
    try {
      const data = await fetchJson<{ suggestions: SuggestedLink[] }>(
        `/owner/entries/${encodeURIComponent(lineageId)}/suggested-links`,
        signal ? { signal } : {},
        "Failed to load suggested links."
      );
      if (!signal?.aborted) {
        const items = data.suggestions ?? [];
        setSuggestions(items);
        const defaults: Record<string, string> = {};
        for (const s of items) {
          defaults[s.id] = s.relation_type || RELATION_TYPES[0];
        }
        setRelationTypes((prev) => ({ ...defaults, ...prev }));
        setLoaded(true);
      }
    } catch {
      if (!signal?.aborted) setLoaded(true);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    void loadSuggestions(controller.signal);
    return () => controller.abort();
  }, [lineageId]);

  if (!loaded || suggestions.length === 0) return null;

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <h3>Suggested Links</h3>
      {promoteError && <p role="alert" style={{ color: "var(--cyber-accent)" }}>{promoteError}</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {suggestions.map((s) => (
          <li key={s.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
            <span className="badge">{s.signal}</span>
            <span style={{ fontWeight: "bold" }}>{s.title}</span>
            <span style={{ color: "var(--cyber-dim, rgba(255,255,255,0.4))", fontSize: "0.8rem" }}>
              score: {s.score.toFixed(2)}
            </span>
            <select
              value={relationTypes[s.id] ?? RELATION_TYPES[0]}
              onChange={(e) =>
                setRelationTypes((prev) => ({ ...prev, [s.id]: e.target.value }))
              }
              style={{ fontSize: "0.8rem" }}
            >
              {RELATION_TYPES.map((rt) => (
                <option key={rt} value={rt}>{rt}</option>
              ))}
            </select>
            <button
              type="button"
              className="cyber-btn cyber-btn--sm"
              disabled={promoting === s.id}
              onClick={async () => {
                setPromoting(s.id);
                setPromoteError(null);
                try {
                  await fetchJson(
                    `/owner/suggested-links/${encodeURIComponent(s.id)}/promote`,
                    {
                      method: "POST",
                      headers: {
                        "content-type": "application/json",
                        "x-csrf-token": csrfToken,
                      },
                      body: JSON.stringify({ relation_type: relationTypes[s.id] ?? RELATION_TYPES[0] }),
                    },
                    "Failed to promote link."
                  );
                  await loadSuggestions();
                } catch (err) {
                  setPromoteError(getErrorMessage(err, "Failed to promote link."));
                } finally {
                  setPromoting(null);
                }
              }}
            >
              {promoting === s.id ? "Promoting..." : "Promote"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface EntryDetailPageProps {
  lineageId: string;
  csrfToken: string;
  onDeleted: (lineageId: string) => void;
  onSelectEntry?: (lineageId: string) => void;
}

export function EntryDetailPage({ lineageId, csrfToken, onDeleted, onSelectEntry }: EntryDetailPageProps) {
  const [history, setHistory] = useState<EntryVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setHistory([]);
    setLoading(true);
    setLoadError(null);
    setActionError(null);
    setConfirmArchive(false);

    const load = async () => {
      try {
        const payload = await fetchJson<{ history: EntryVersion[] }>(
          `/owner/entries/${encodeURIComponent(lineageId)}`,
          { signal: controller.signal },
          "Failed to load entry history."
        );

        setHistory(payload.history ?? []);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setLoadError(getErrorMessage(error, "Failed to load entry history."));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      controller.abort();
    };
  }, [lineageId]);

  if (loading) {
    return <section role="status">Loading entry history...</section>;
  }

  if (loadError) {
    return <section role="alert">{loadError}</section>;
  }

  const latest = history[0];
  if (!latest) {
    return <section>No entry history available.</section>;
  }

  return (
    <section>
      <h2>{latest.title}</h2>
      <p>
        {latest.tags.length > 0
          ? latest.tags.map((tag) => <span key={tag} className="badge" style={{ marginRight: 6 }}>{tag}</span>)
          : <span style={{ color: "var(--muted-fg)" }}>no tags</span>}
      </p>
      <MarkdownView markdown={latest.body_markdown} />

      {actionError ? <p role="alert">{actionError}</p> : null}

      <div>
        <button
          type="button"
          className={confirmArchive ? "cyber-btn cyber-btn--outline cyber-btn--sm" : "cyber-btn cyber-btn--secondary cyber-btn--sm"}
          disabled={deleting}
          onClick={() => {
            setActionError(null);
            setConfirmArchive((value) => !value);
          }}
        >
          {confirmArchive ? "Cancel Archive" : "Archive Entry"}
        </button>

        {confirmArchive ? (
          <div>
            <p>This will remove the entry from active lists. Continue?</p>
            <button
              type="button"
              className="cyber-btn cyber-btn--secondary"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                setActionError(null);

                try {
                  await fetchJson<{ status: string }>(
                    `/owner/entries/${encodeURIComponent(lineageId)}`,
                    {
                      method: "DELETE",
                      headers: {
                        "x-csrf-token": csrfToken
                      }
                    },
                    "Failed to archive entry."
                  );

                  onDeleted(lineageId);
                } catch (error) {
                  setActionError(getErrorMessage(error, "Failed to archive entry."));
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? "Archiving..." : "Confirm Archive"}
            </button>
          </div>
        ) : null}
      </div>

      <h3>Edit Entry</h3>
      <EntryEditor
        key={latest.id}
        initialTitle={latest.title}
        initialBody={latest.body_markdown}
        initialTags={latest.tags}
        submitLabel="Save New Version"
        onSubmit={async (payload) => {
          await fetchJson(
            `/owner/entries/${encodeURIComponent(lineageId)}/edit`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-csrf-token": csrfToken
              },
              body: JSON.stringify({
                expected_version: latest.version_number,
                title: payload.title,
                body_markdown: payload.body_markdown,
                tags: payload.tags
              })
            },
            "Failed to save entry version."
          );

          const payloadRefreshed = await fetchJson<{ history: EntryVersion[] }>(
            `/owner/entries/${encodeURIComponent(lineageId)}`,
            {},
            "Failed to refresh entry history."
          );

          setHistory(payloadRefreshed.history ?? []);
          setActionError(null);
          setConfirmArchive(false);
        }}
      />

      <h3>Version History</h3>
      <ol>
        {history.map((version) => (
          <li key={version.id}>
            Version {version.version_number}
            {version.tags.length > 0 ? ` [${version.tags.join(", ")}]` : " [no tags]"}
          </li>
        ))}
      </ol>

      <BacklinksSection
        lineageId={lineageId}
        onSelectEntry={onSelectEntry ?? (() => {})}
      />

      <SuggestedLinksSection
        lineageId={lineageId}
        csrfToken={csrfToken}
      />
    </section>
  );
}
