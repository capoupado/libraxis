import { useEffect, useState } from "react";

import { fetchJson, getErrorMessage } from "../lib/http-client.js";

interface EntrySummary {
  id: string;
  lineage_id: string;
  title: string;
  type: string;
  tags: string[];
}

export interface EntriesPageProps {
  onSelectEntry: (lineageId: string) => void;
  refreshToken?: number;
}

export function EntriesPage({ onSelectEntry, refreshToken = 0 }: EntriesPageProps) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<EntrySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const run = async () => {
      setLoading(true);
      setError(null);

      try {
        const payload = await fetchJson<{ items: EntrySummary[] }>(
          `/owner/entries?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
          "Failed to load entries."
        );

        if (active) {
          setItems(payload.items ?? []);
        }
      } catch (caught) {
        if (controller.signal.aborted || !active) {
          return;
        }

        setItems([]);
        setError(getErrorMessage(caught, "Failed to load entries."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      controller.abort();
      active = false;
    };
  }, [query, refreshToken]);

  const showEmpty = !loading && !error && items.length === 0;
  const emptyMessage = query.trim().length > 0 ? "No entries match this search." : "No entries yet.";

  return (
    <section>
      <h2>Entries</h2>
      <div className="cyber-input">
        <span className="cyber-input__prefix">&gt;</span>
        <input
          placeholder="Search entries"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {loading ? <p role="status">Loading entries...</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {showEmpty ? <p>{emptyMessage}</p> : null}

      <div>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="entry-item"
            onClick={() => onSelectEntry(item.lineage_id)}
          >
            {item.title} ({item.type})
            {item.tags.length > 0 ? ` [${item.tags.join(", ")}]` : " [no tags]"}
          </button>
        ))}
      </div>
    </section>
  );
}
