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
      <h1>Libraxis Owner Login</h1>
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
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? <p role="alert">{error}</p> : null}

        <button type="submit" disabled={busy}>
          {busy ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </main>
  );
}
