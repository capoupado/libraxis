import { useEffect, useRef, useState } from "react";

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
  source_entry_id: string;
  target_entry_id: string;
  target_lineage_id: string;
  target_title: string;
  target_type: string;
  target_body_preview: string | null;
  signal: string;
  score: number;
  relation_type: string | null;
  rationale: string | null;
  generated_at: string;
}

type DetailPane = "overview" | "edit" | "links" | "history";

const RELATION_TYPES = [
  "related_to",
  "caused_by",
  "resolved_by",
  "composes",
  "used_skill",
];
const DEFAULT_RELATION_TYPE = RELATION_TYPES[0] ?? "related_to";

const SIGNAL_LABELS: Record<string, string> = {
  fts: "FTS",
  tag: "TAGS",
  embedding: "EMBED",
};

const RELATION_HINTS: Record<string, string> = {
  related_to: "General association between the two entries.",
  caused_by: "Use when this entry happened because of the target entry.",
  resolved_by: "Use when the target entry resolves this entry.",
  composes: "Use when this skill is composed of the target skill.",
  used_skill: "Use when this run used the target skill.",
};

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isLikelyEntryId(value: string): boolean {
  const candidate = value.trim();
  return ULID_PATTERN.test(candidate) || UUID_PATTERN.test(candidate);
}

function truncateText(value: string, max = 80): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 3)}...`;
}

function getSuggestedTargetLabel(s: SuggestedLink): string {
  const title = (s.target_title ?? "").trim();
  if (title && !isLikelyEntryId(title)) {
    return truncateText(title, 90);
  }

  const preview = (s.target_body_preview ?? "").replace(/\s+/g, " ").trim();
  if (preview && !isLikelyEntryId(preview)) {
    return truncateText(preview, 90);
  }

  const typeLabel = (s.target_type ?? "entry").trim() || "entry";
  return `Untitled ${typeLabel} entry`;
}

function BacklinksSection({
  lineageId,
  onSelectEntry,
}: {
  lineageId: string;
  onSelectEntry: (id: string) => void;
}) {
  const [nodes, setNodes] = useState<BacklinkNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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
          setLoadError(null);
          setLoaded(true);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Failed to load backlinks:", err);
          setLoadError("Failed to load backlinks.");
          setLoaded(true);
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [lineageId]);

  if (!loaded) return null;
  if (nodes.length === 0 && !loadError) return null;

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <h3>Backlinks</h3>
      {loadError && <p role="alert" style={{ color: "var(--cyber-accent)" }}>{loadError}</p>}
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
  onSelectEntry,
}: {
  lineageId: string;
  csrfToken: string;
  onSelectEntry?: (lineageId: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<SuggestedLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [relationTypes, setRelationTypes] = useState<Record<string, string>>({});
  const [promoting, setPromoting] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadSuggestions = async (signal?: AbortSignal) => {
    try {
      const data = await fetchJson<{ suggestions: SuggestedLink[] }>(
        `/owner/entries/${encodeURIComponent(lineageId)}/suggested-links`,
        signal ? { signal } : {},
        "Failed to load suggested links."
      );
      if (!signal?.aborted && mountedRef.current) {
        const items = data.suggestions ?? [];
        setSuggestions(items);
        const defaults: Record<string, string> = {};
        for (const s of items) {
          defaults[s.id] = s.relation_type || DEFAULT_RELATION_TYPE;
        }
        setRelationTypes((prev) => ({ ...defaults, ...prev }));
        setLoadError(null);
        setLoaded(true);
      }
    } catch (err) {
      if (!signal?.aborted && mountedRef.current) {
        setLoadError(getErrorMessage(err, "Failed to load suggested links."));
        setLoaded(true);
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    void loadSuggestions(controller.signal);
    return () => controller.abort();
  }, [lineageId]);

  if (!loaded) return null;
  if (suggestions.length === 0 && !loadError) return null;

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <h3>Suggested Links</h3>
      {loadError && <p role="alert" style={{ color: "var(--cyber-accent)" }}>{loadError}</p>}
      {promoteError && <p role="alert" style={{ color: "var(--cyber-accent)" }}>{promoteError}</p>}
      <p className="suggested-link-help">
        These are candidate links from this entry to other entries. Review the target, choose a relation,
        then promote to create a real link.
      </p>
      <ul className="suggested-links-list">
        {suggestions.map((s) => {
          const selectedRelation = relationTypes[s.id] ?? s.relation_type ?? DEFAULT_RELATION_TYPE;
          const targetTitle = getSuggestedTargetLabel(s);
          const relationHint = RELATION_HINTS[selectedRelation] ?? RELATION_HINTS[DEFAULT_RELATION_TYPE];

          return (
            <li key={s.id} className="suggested-link-card">
              <div className="suggested-link-head">
                <span className="badge">{SIGNAL_LABELS[s.signal] ?? s.signal}</span>
                <span className="suggested-link-score">score: {s.score.toFixed(2)}</span>
              </div>

              <div className="suggested-link-target-row">
                <p className="suggested-link-target-title" title={targetTitle}>{targetTitle}</p>
                <span className="badge">{s.target_type}</span>
              </div>

              <p className="suggested-link-direction">
                this entry -&gt; {selectedRelation} -&gt; {targetTitle}
              </p>

              <p className="suggested-link-rationale">
                {s.rationale ?? "No rationale provided by the scorer for this suggestion."}
              </p>

              <p className="suggested-link-hint">{relationHint}</p>

              <div className="suggested-link-controls">
                <div className="suggested-link-relation">
                  <span>relation</span>
                  <select
                    value={selectedRelation}
                    onChange={(e) =>
                      setRelationTypes((prev) => ({ ...prev, [s.id]: e.target.value }))
                    }
                    aria-label={`Relation type for ${targetTitle}`}
                  >
                    {RELATION_TYPES.map((rt) => (
                      <option key={rt} value={rt}>{rt}</option>
                    ))}
                  </select>
                </div>

                {onSelectEntry ? (
                  <button
                    type="button"
                    className="cyber-btn cyber-btn--ghost cyber-btn--sm"
                    onClick={() => onSelectEntry(s.target_lineage_id)}
                  >
                    Open Target
                  </button>
                ) : null}

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
                          body: JSON.stringify({ relation_type: selectedRelation }),
                        },
                        "Failed to promote link."
                      );
                      if (mountedRef.current) {
                        setRelationTypes(prev => { const next = {...prev}; delete next[s.id]; return next; });
                        await loadSuggestions();
                      }
                    } catch (err) {
                      if (mountedRef.current) setPromoteError(getErrorMessage(err, "Failed to promote link."));
                    } finally {
                      if (mountedRef.current) setPromoting(null);
                    }
                  }}
                >
                  {promoting === s.id ? "Promoting..." : "Promote"}
                </button>
              </div>
            </li>
          );
        })}
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
  const [restoring, setRestoring] = useState(false);
  const [archived, setArchived] = useState(false);
  const [pane, setPane] = useState<DetailPane>("overview");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiveConfirmationInput, setArchiveConfirmationInput] = useState("");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setHistory([]);
    setLoading(true);
    setLoadError(null);
    setPane("overview");
    setArchived(false);
    setActionError(null);
    setActionStatus(null);
    setConfirmArchive(false);
    setArchiveConfirmationInput("");

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

  const canArchive = archiveConfirmationInput.trim() === latest.title;

  if (archived) {
    return (
      <section className="detail-pane detail-pane--danger">
        <h2>Entry Archived</h2>
        <p>
          <strong>{latest.title}</strong> has been archived and removed from active lists.
        </p>
        <p className="danger-zone__hint">
          You can restore it now, or return to the list to continue curation.
        </p>
        {actionError ? <p role="alert">{actionError}</p> : null}
        {actionStatus ? <p role="status">{actionStatus}</p> : null}
        <div className="detail-actions">
          <button
            type="button"
            className="cyber-btn"
            disabled={restoring}
            onClick={async () => {
              setRestoring(true);
              setActionError(null);
              setActionStatus(null);

              try {
                await fetchJson<{ status: string }>(
                  `/owner/entries/${encodeURIComponent(lineageId)}/restore`,
                  {
                    method: "POST",
                    headers: {
                      "x-csrf-token": csrfToken
                    }
                  },
                  "Failed to restore entry."
                );

                const payloadRefreshed = await fetchJson<{ history: EntryVersion[] }>(
                  `/owner/entries/${encodeURIComponent(lineageId)}`,
                  {},
                  "Failed to refresh entry history."
                );

                setHistory(payloadRefreshed.history ?? []);
                setArchived(false);
                setPane("overview");
                setActionStatus("Entry restored successfully.");
              } catch (error) {
                setActionError(getErrorMessage(error, "Failed to restore entry."));
              } finally {
                setRestoring(false);
              }
            }}
          >
            {restoring ? "Restoring..." : "Restore Entry"}
          </button>
          <button
            type="button"
            className="cyber-btn cyber-btn--ghost"
            disabled={restoring}
            onClick={() => onDeleted(lineageId)}
          >
            Back to Entry List
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="detail-layout">
      <header className="detail-header">
        <h2>{latest.title}</h2>
        <p>
          {latest.tags.length > 0
            ? latest.tags.map((tag) => <span key={tag} className="badge" style={{ marginRight: 6 }}>{tag}</span>)
            : <span style={{ color: "var(--muted-fg)" }}>no tags</span>}
        </p>
      </header>

      {actionError ? <p role="alert">{actionError}</p> : null}
      {actionStatus ? <p role="status">{actionStatus}</p> : null}

      <nav className="detail-tabs" aria-label="Entry detail sections">
        <button
          type="button"
          className={`cyber-btn cyber-btn--sm${pane === "overview" ? " active" : ""}`}
          onClick={() => setPane("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          className={`cyber-btn cyber-btn--sm${pane === "edit" ? " active" : ""}`}
          onClick={() => setPane("edit")}
        >
          Edit
        </button>
        <button
          type="button"
          className={`cyber-btn cyber-btn--sm${pane === "links" ? " active" : ""}`}
          onClick={() => setPane("links")}
        >
          Links
        </button>
        <button
          type="button"
          className={`cyber-btn cyber-btn--sm${pane === "history" ? " active" : ""}`}
          onClick={() => setPane("history")}
        >
          History
        </button>
      </nav>

      {pane === "overview" ? (
        <section className="detail-pane">
          <MarkdownView markdown={latest.body_markdown} />
        </section>
      ) : null}

      {pane === "edit" ? (
        <section className="detail-pane">
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
              setActionStatus("New version saved.");
              setConfirmArchive(false);
            }}
          />
        </section>
      ) : null}

      {pane === "links" ? (
        <section className="detail-pane">
          <BacklinksSection
            lineageId={lineageId}
            onSelectEntry={onSelectEntry ?? (() => {})}
          />
          <SuggestedLinksSection
            lineageId={lineageId}
            csrfToken={csrfToken}
            onSelectEntry={onSelectEntry}
          />
        </section>
      ) : null}

      {pane === "history" ? (
        <section className="detail-pane">
          <h3>Version History</h3>
          <ol>
            {history.map((version) => (
              <li key={version.id}>
                Version {version.version_number}
                {version.tags.length > 0 ? ` [${version.tags.join(", ")}]` : " [no tags]"}
              </li>
            ))}
          </ol>

          <section className="danger-zone">
            <h3>Danger Zone</h3>
            <p className="danger-zone__hint">
              Archiving removes this entry from active lists. You can restore it before leaving this screen.
            </p>

            <button
              type="button"
              className={confirmArchive ? "cyber-btn cyber-btn--outline cyber-btn--sm" : "cyber-btn cyber-btn--secondary cyber-btn--sm"}
              disabled={deleting}
              onClick={() => {
                setActionError(null);
                setActionStatus(null);
                setArchiveConfirmationInput("");
                setConfirmArchive((value) => !value);
              }}
            >
              {confirmArchive ? "Cancel Archive" : "Archive Entry"}
            </button>

            {confirmArchive ? (
              <div className="danger-zone__confirm">
                <p>
                  Type <strong>{latest.title}</strong> to confirm archive.
                </p>
                <div className="cyber-input">
                  <span className="cyber-input__prefix">&gt;</span>
                  <input
                    value={archiveConfirmationInput}
                    onChange={(event) => setArchiveConfirmationInput(event.target.value)}
                    placeholder="Type entry title to confirm"
                  />
                </div>
                <div className="detail-actions">
                  <button
                    type="button"
                    className="cyber-btn cyber-btn--secondary"
                    disabled={deleting || !canArchive}
                    onClick={async () => {
                      setDeleting(true);
                      setActionError(null);
                      setActionStatus(null);

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

                        setArchived(true);
                        setConfirmArchive(false);
                        setArchiveConfirmationInput("");
                        setActionStatus("Entry archived.");
                      } catch (error) {
                        setActionError(getErrorMessage(error, "Failed to archive entry."));
                      } finally {
                        setDeleting(false);
                      }
                    }}
                  >
                    {deleting ? "Archiving..." : "Confirm Archive"}
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn--ghost"
                    disabled={deleting}
                    onClick={() => {
                      setConfirmArchive(false);
                      setArchiveConfirmationInput("");
                    }}
                  >
                    Keep Entry Active
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </section>
      ) : null}
    </section>
  );
}
