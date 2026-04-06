import { useEffect, useState } from "react";

import { fetchJson, getErrorMessage } from "../lib/http-client.js";

interface ApiKeyRow {
  id: string;
  name: string;
  scopes: string[];
  is_revoked: boolean;
}

export interface ApiKeysPageProps {
  csrfToken: string;
}

export function ApiKeysPage({ csrfToken }: ApiKeysPageProps) {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [name, setName] = useState("automation-client");
  const [scopes, setScopes] = useState("read,write");
  const [latestPlaintext, setLatestPlaintext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const refresh = async () => {
    const payload = await fetchJson<{ keys: ApiKeyRow[] }>(
      "/admin/api-keys",
      {},
      "Failed to load API keys."
    );

    setKeys(payload.keys ?? []);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        await refresh();
      } catch (caught) {
        setError(getErrorMessage(caught, "Failed to load API keys."));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  useEffect(() => {
    if (!latestPlaintext) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setLatestPlaintext(null);
      setStatusMessage("New key was hidden after 60 seconds.");
    }, 60_000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [latestPlaintext]);

  return (
    <section>
      <h2>API Keys</h2>
      {loading ? <p role="status">Loading API keys...</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {statusMessage ? <p role="status">{statusMessage}</p> : null}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setSubmitting(true);
          setError(null);
          setStatusMessage("");

          try {
            const payload = await fetchJson<{ plaintext_key?: string }>(
              "/admin/api-keys",
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-csrf-token": csrfToken
                },
                body: JSON.stringify({
                  name,
                  scopes: scopes
                    .split(",")
                    .map((scope) => scope.trim())
                    .filter(Boolean)
                })
              },
              "Failed to create API key."
            );

            setLatestPlaintext(payload.plaintext_key ?? null);
            setStatusMessage("API key created.");
            await refresh();
          } catch (caught) {
            setError(getErrorMessage(caught, "Failed to create API key."));
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <label className="cyber-label"><span className="dot"></span> Name</label>
        <div className="cyber-input">
          <span className="cyber-input__prefix">&gt;</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </div>

        <label className="cyber-label"><span className="dot"></span> Scopes</label>
        <div className="cyber-input">
          <span className="cyber-input__prefix">&gt;</span>
          <input value={scopes} onChange={(event) => setScopes(event.target.value)} />
        </div>

        <button type="submit" className="cyber-btn cyber-btn--glitch" disabled={submitting}>
          {submitting ? "Creating..." : "Create API Key"}
        </button>
      </form>

      {latestPlaintext ? (
        <section className="secret-panel">
          <p>New key (shown once). Copy it now; it auto-hides after 60 seconds.</p>
          <pre className="secret-value">{latestPlaintext}</pre>
          <div>
            <button
              type="button"
              className="cyber-btn cyber-btn--sm"
              onClick={async () => {
                try {
                  if (!navigator.clipboard?.writeText) {
                    throw new Error("Clipboard access is unavailable in this browser.");
                  }

                  await navigator.clipboard.writeText(latestPlaintext);
                  setStatusMessage("API key copied to clipboard.");
                } catch (caught) {
                  setError(getErrorMessage(caught, "Failed to copy API key."));
                }
              }}
            >
              Copy Key
            </button>
            <button
              type="button"
              className="cyber-btn cyber-btn--outline cyber-btn--sm"
              onClick={() => {
                setLatestPlaintext(null);
                setStatusMessage("API key hidden.");
              }}
            >
              Hide
            </button>
          </div>
        </section>
      ) : null}

      <ul>
        {keys.map((key) => (
          <li key={key.id}>
            {key.name} [{key.scopes.join(",")}], revoked: {String(key.is_revoked)}
            <button
              type="button"
              className="cyber-btn cyber-btn--secondary cyber-btn--sm"
              disabled={revokingId === key.id}
              onClick={async () => {
                setError(null);
                setStatusMessage("");
                setRevokingId(key.id);
                try {
                  await fetchJson(
                    `/admin/api-keys/${key.id}/revoke`,
                    {
                      method: "POST",
                      headers: {
                        "x-csrf-token": csrfToken
                      }
                    },
                    "Failed to revoke API key."
                  );

                  setStatusMessage(`Revoked key ${key.name}.`);
                  await refresh();
                } catch (caught) {
                  setError(getErrorMessage(caught, "Failed to revoke API key."));
                } finally {
                  setRevokingId(null);
                }
              }}
            >
              {revokingId === key.id ? "Revoking..." : "Revoke"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
