import { useEffect, useMemo, useState } from "react";

import { AgentsPage } from "./pages/agents-page.js";
import { EntryEditor } from "./components/entry-editor.js";
import { ApiKeysPage } from "./pages/api-keys-page.js";
import { EntriesPage } from "./pages/entries-page.js";
import { EntryDetailPage } from "./pages/entry-detail-page.js";
import { HowToPage } from "./pages/how-to-page.js";
import { LoginPage } from "./pages/login.js";
import { ProposalsPage } from "./pages/proposals-page.js";
import { SkillsDashboardPage } from "./pages/skills-dashboard-page.js";
import { fetchJson, getErrorMessage } from "./lib/http-client.js";

type TabKey = "entries" | "new" | "agents" | "proposals" | "dashboard" | "keys" | "howto";

const ASCII_HEADER = `
 ██╗     ██╗██████╗ ██████╗  █████╗ ██╗  ██╗██╗███████╗
 ██║     ██║██╔══██╗██╔══██╗██╔══██╗╚██╗██╔╝██║██╔════╝
 ██║     ██║██████╔╝██████╔╝███████║ ╚███╔╝ ██║███████╗
 ██║     ██║██╔══██╗██╔══██╗██╔══██║ ██╔██╗ ██║╚════██║
 ███████╗██║██████╔╝██║  ██║██║  ██║██╔╝ ██╗██║███████║
 ╚══════╝╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚══════╝
                                                                                              
`;

export function App() {
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState<TabKey>("entries");
  const [selectedLineageId, setSelectedLineageId] = useState<string | null>(null);
  const [entriesRefreshToken, setEntriesRefreshToken] = useState(0);
  const [newEntryType, setNewEntryType] = useState<
    "lesson" | "note" | "skill" | "user" | "feedback" | "project" | "reference"
  >("note");
  const [feedback, setFeedback] = useState<string>("");
  const [appError, setAppError] = useState<string>("");

  const tabs = useMemo(
    () => [
      { key: "entries" as const, label: "Entries" },
      { key: "new" as const, label: "New Entry" },
      { key: "agents" as const, label: "Agents" },
      { key: "proposals" as const, label: "Proposals" },
      { key: "dashboard" as const, label: "Dashboard" },
      { key: "keys" as const, label: "API Keys" },
      { key: "howto" as const, label: "How-To" }
    ],
    []
  );

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      try {
        const response = await fetch("/owner/session");

        if (response.status === 401) {
          return;
        }

        if (!response.ok) {
          throw new Error("Failed to restore owner session.");
        }

        const payload = (await response.json()) as { csrf_token?: unknown };
        if (active && typeof payload.csrf_token === "string" && payload.csrf_token.length > 0) {
          setCsrfToken(payload.csrf_token);
        }
      } catch (caught) {
        if (active) {
          setAppError(getErrorMessage(caught, "Failed to restore owner session."));
        }
      } finally {
        if (active) {
          setAuthChecked(true);
        }
      }
    };

    void restoreSession();

    return () => {
      active = false;
    };
  }, []);

  if (!authChecked) {
    return (
      <div className="shell centered">
        <p role="status">Restoring session...</p>
      </div>
    );
  }

  if (!csrfToken) {
    return (
      <div className="shell centered">
        {appError ? <p role="alert">{appError}</p> : null}
        <LoginPage
          onLoggedIn={(token) => {
            setAppError("");
            setCsrfToken(token);
          }}
        />
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <pre className="ascii-header">{ASCII_HEADER}</pre>
        <div className="topbar-actions">
          <button
            type="button"
            onClick={async () => {
              setAppError("");
              try {
                await fetchJson(
                  "/owner/logout",
                  {
                    method: "POST",
                    headers: {
                      "x-csrf-token": csrfToken
                    }
                  },
                  "Failed to logout."
                );

                setCsrfToken(null);
                setSelectedLineageId(null);
                setTab("entries");
              } catch (caught) {
                setAppError(getErrorMessage(caught, "Failed to logout."));
              }
            }}
          >
            logout
          </button>
        </div>
        {appError ? <p role="alert">{appError}</p> : null}
      </header>

      <nav className="tabs" aria-label="Primary">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? "active" : ""}
            onClick={() => {
              setFeedback("");
              setAppError("");
              setTab(item.key);
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === "entries" ? (
          <section className="split">
            <div className="pane">
              <div className="pane-header">Entry List</div>
              <div className="panel">
                <EntriesPage
                  refreshToken={entriesRefreshToken}
                  onSelectEntry={(lineageId) => {
                    setSelectedLineageId(lineageId);
                  }}
                />
              </div>
            </div>
            <div className="pane">
              <div className="pane-header">Entry Detail</div>
              <div className="panel">
                {selectedLineageId ? (
                  <EntryDetailPage
                    lineageId={selectedLineageId}
                    csrfToken={csrfToken}
                    onDeleted={() => {
                      setSelectedLineageId(null);
                      setEntriesRefreshToken((value) => value + 1);
                    }}
                  />
                ) : (
                  <p>Select an entry to view details and history.</p>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {tab === "new" ? (
          <section className="pane">
            <div className="pane-header">Create New Entry</div>
            <div className="panel">
              <label>
                Entry Type
                <select
                  value={newEntryType}
                  onChange={(event) =>
                    setNewEntryType(
                      event.target.value as
                        | "lesson"
                        | "note"
                        | "skill"
                        | "user"
                        | "feedback"
                        | "project"
                        | "reference"
                    )
                  }
                >
                  <option value="user">user — who the user is</option>
                  <option value="feedback">feedback — correction or guidance</option>
                  <option value="project">project — active project context</option>
                  <option value="reference">reference — external link or resource</option>
                  <option value="note">note — freeform observation</option>
                  <option value="lesson">lesson — distilled learning</option>
                  <option value="skill">skill — reusable instructions</option>
                </select>
              </label>

              <EntryEditor
                submitLabel="Create Entry"
                onSubmit={async (payload) => {
                  setAppError("");
                  const metadata =
                    newEntryType === "skill"
                      ? { skill_type: "instructions", steps: [] as Array<Record<string, unknown>> }
                      : {};

                  const created = await fetchJson<{ lineage_id: string }>(
                    "/owner/entries",
                    {
                      method: "POST",
                      headers: {
                        "content-type": "application/json",
                        "x-csrf-token": csrfToken
                      },
                      body: JSON.stringify({
                        type: newEntryType,
                        title: payload.title,
                        body_markdown: payload.body_markdown,
                        tags: payload.tags,
                        metadata
                      })
                    },
                    "Failed to create entry"
                  );

                  setFeedback("Entry created successfully.");
                  setSelectedLineageId(created.lineage_id);
  
                  setEntriesRefreshToken((value) => value + 1);
                  setTab("entries");
                }}
              />
              {feedback ? <p role="status">{feedback}</p> : null}
            </div>
          </section>
        ) : null}

        {tab === "agents" ? (
          <section className="pane">
            <div className="pane-header">Portable Agents</div>
            <div className="panel">
              <AgentsPage csrfToken={csrfToken} />
            </div>
          </section>
        ) : null}

        {tab === "proposals" ? (
          <section className="pane">
            <div className="pane-header">Skill Proposals</div>
            <div className="panel">
              <ProposalsPage csrfToken={csrfToken} />
            </div>
          </section>
        ) : null}

        {tab === "dashboard" ? (
          <section className="pane">
            <div className="pane-header">Skills Dashboard</div>
            <div className="panel">
              <SkillsDashboardPage />
            </div>
          </section>
        ) : null}

        {tab === "keys" ? (
          <section className="pane">
            <div className="pane-header">API Key Management</div>
            <div className="panel">
              <ApiKeysPage csrfToken={csrfToken} />
            </div>
          </section>
        ) : null}

        {tab === "howto" ? (
          <section className="pane">
            <div className="pane-header">How-To</div>
            <div className="panel">
              <HowToPage />
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
