import { useEffect, useMemo, useState } from "react";

import { AgentsPage } from "./pages/agents-page.js";
import { EntryEditor } from "./components/entry-editor.js";
import { ApiKeysPage } from "./pages/api-keys-page.js";
import { EntriesPage } from "./pages/entries-page.js";
import { EntryDetailPage } from "./pages/entry-detail-page.js";
import { GraphPage } from "./pages/graph-page.js";
import { HowToPage } from "./pages/how-to-page.js";
import { LoginPage } from "./pages/login.js";
import { ProposalsPage } from "./pages/proposals-page.js";
import { SkillsDashboardPage } from "./pages/skills-dashboard-page.js";
import { fetchJson, getErrorMessage } from "./lib/http-client.js";

type TabKey = "entries" | "new" | "agents" | "proposals" | "dashboard" | "keys" | "howto" | "graph";


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
      { key: "graph" as const, label: "Graph" },
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
        <h1 className="cyber-glitch" data-text="LIBRAXIS">LIBRAXIS</h1>
        <div className="topbar-actions">
          <button
            type="button"
            className="cyber-btn cyber-btn--ghost"
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
            className={`cyber-btn cyber-btn--sm${tab === item.key ? " active" : ""}`}
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
          selectedLineageId ? (
            <section className="cyber-card cyber-card--terminal">
              <div className="terminal__bar">
                <button
                  type="button"
                  className="cyber-btn cyber-btn--ghost cyber-btn--sm"
                  onClick={() => setSelectedLineageId(null)}
                >
                  &larr; Back
                </button>
                <span className="terminal__title">Entry Detail</span>
              </div>
              <div className="terminal__body">
                <EntryDetailPage
                  lineageId={selectedLineageId}
                  csrfToken={csrfToken}
                  onDeleted={() => {
                    setSelectedLineageId(null);
                    setEntriesRefreshToken((value) => value + 1);
                  }}
                />
              </div>
            </section>
          ) : (
            <section className="cyber-card cyber-card--terminal">
              <div className="terminal__bar"><span className="terminal__title">Entry List</span></div>
              <div className="terminal__body">
                <EntriesPage
                  refreshToken={entriesRefreshToken}
                  onSelectEntry={(lineageId) => {
                    setSelectedLineageId(lineageId);
                  }}
                />
              </div>
            </section>
          )
        ) : null}

        {tab === "new" ? (
          <section className="cyber-card cyber-card--terminal">
            <div className="terminal__bar"><span className="terminal__title">Create New Entry</span></div>
            <div className="terminal__body">
              <label className="cyber-label">
                <span className="dot"></span> Entry Type
              </label>
              <div className="cyber-input">
                <span className="cyber-input__prefix">&gt;</span>
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
              </div>

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

        {tab === "graph" ? (
          <GraphPage
            selectedLineageId={selectedLineageId}
            setSelectedLineageId={setSelectedLineageId}
            setTab={setTab}
            csrfToken={csrfToken}
          />
        ) : null}

        {tab === "agents" ? (
          <section className="cyber-card cyber-card--terminal">
            <div className="terminal__bar"><span className="terminal__title">Portable Agents</span></div>
            <div className="terminal__body">
              <AgentsPage csrfToken={csrfToken} />
            </div>
          </section>
        ) : null}

        {tab === "proposals" ? (
          <section className="cyber-card cyber-card--terminal">
            <div className="terminal__bar"><span className="terminal__title">Skill Proposals</span></div>
            <div className="terminal__body">
              <ProposalsPage csrfToken={csrfToken} />
            </div>
          </section>
        ) : null}

        {tab === "dashboard" ? (
          <section className="cyber-card cyber-card--terminal">
            <div className="terminal__bar"><span className="terminal__title">Skills Dashboard</span></div>
            <div className="terminal__body">
              <SkillsDashboardPage />
            </div>
          </section>
        ) : null}

        {tab === "keys" ? (
          <section className="cyber-card cyber-card--terminal">
            <div className="terminal__bar"><span className="terminal__title">API Key Management</span></div>
            <div className="terminal__body">
              <ApiKeysPage csrfToken={csrfToken} />
            </div>
          </section>
        ) : null}

        {tab === "howto" ? (
          <section className="cyber-card cyber-card--terminal">
            <div className="terminal__bar"><span className="terminal__title">How-To</span></div>
            <div className="terminal__body">
              <HowToPage />
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
