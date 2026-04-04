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

export interface EntryDetailPageProps {
  lineageId: string;
  csrfToken: string;
  onDeleted: (lineageId: string) => void;
}

export function EntryDetailPage({ lineageId, csrfToken, onDeleted }: EntryDetailPageProps) {
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
      <p>{latest.tags.length > 0 ? `Tags: ${latest.tags.join(", ")}` : "Tags: none"}</p>
      <MarkdownView markdown={latest.body_markdown} />

      {actionError ? <p role="alert">{actionError}</p> : null}

      <div>
        <button
          type="button"
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
              className="error"
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
    </section>
  );
}
