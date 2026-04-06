import { useState } from "react";

import { fetchJson, getErrorMessage } from "../lib/http-client.js";

export interface LoginPageProps {
  onLoggedIn: (csrfToken: string) => void;
}

export function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <main>
      <div className="cyber-card cyber-card--holographic" style={{ maxWidth: 420, width: "100%" }}>
        <h1 className="cyber-glitch" data-text="LIBRAXIS" style={{ textAlign: "center", marginBottom: "1.5rem" }}>LIBRAXIS</h1>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);

            try {
              const payload = await fetchJson<{ csrf_token: string }>(
                "/owner/login",
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ username, password })
                },
                "Login failed"
              );

              onLoggedIn(payload.csrf_token);
            } catch (error) {
              setError(getErrorMessage(error, "Login failed"));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="cyber-label"><span className="dot"></span> Username</label>
          <div className="cyber-input">
            <span className="cyber-input__prefix">&gt;</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </div>

          <label className="cyber-label"><span className="dot"></span> Password</label>
          <div className="cyber-input">
            <span className="cyber-input__prefix">&gt;</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error ? <p role="alert">{error}</p> : null}

          <button type="submit" className="cyber-btn cyber-btn--glitch" disabled={busy} style={{ width: "100%", marginTop: "1rem" }}>
            {busy ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </main>
  );
}
