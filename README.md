![Libraxis](https://i.imgur.com/KkUnuxv.png)

# Libraxis

> Local-first knowledge and skills platform for people and agents.

[![License](https://img.shields.io/github/license/capoupado/libraxis)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-blue)](https://modelcontextprotocol.io)

Libraxis is a self-hosted backend for storing, retrieving, and evolving knowledge entries and agent skills — accessible via a REST API, an MCP server, and a React web UI.

---

## Features

| | | |
|---|---|---|
| **HTTP API** | Entries, context, skills, proposals, and admin operations via Fastify | |
| **MCP Server** | Streamable HTTP (`/mcp`) and stdio transport | |
| **React Web UI** | Owner login, curation, API key management, proposals, agents | |
| **Local-first** | SQLite storage with append-only versioning — no cloud required | |

---
## Screenshots

<p align="center">

<!-- SCREENSHOT: Web UI – dashboard / entry list -->
![WebUI](https://i.imgur.com/ldESpPY.png)

<!-- SCREENSHOT: MCP tool in action (e.g. Claude Desktop) -->
![MCP](https://i.imgur.com/wArKMvO.png) ![MCP2](https://i.imgur.com/kkfP18c.png)

</p>

---

## Quick Start

**Prerequisites:** Node.js 20+, npm 10+

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

In a second terminal:

```bash
npm run web:dev
```

Then open:

- Web UI: `http://localhost:5173`
- API health: `http://localhost:3000/health`

---

## Environment Variables

`.env.example` ships with safe local defaults:

```dotenv
NODE_ENV=development
PORT=3000
LIBRAXIS_DB_PATH=./data/libraxis.db
LIBRAXIS_ADMIN_USERNAME=admin
LIBRAXIS_ADMIN_PASSWORD=change-me
LIBRAXIS_SESSION_TTL_DAYS=7
LIBRAXIS_MCP_API_KEY=
```

> **Production rule:** default owner credentials are rejected when `NODE_ENV=production`.

Optional web dev proxy override:

```dotenv
LIBRAXIS_BACKEND_URL=http://localhost:3000
```

---

## MCP Integration

### HTTP (Recommended)

```json
{
  "mcpServers": {
    "libraxis-http": {
      "url": "http://<your-domain>/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_API_KEY>"
      }
    }
  }
}
```

> Initialize and follow-up session calls must use the same API key. Use `http://localhost:<PORT>/mcp` locally — plain HTTP only unless you add TLS termination.

### stdio (Fallback)

```bash
export LIBRAXIS_MCP_API_KEY=<YOUR_API_KEY>
npm run mcp:dev
```

```json
{
  "mcpServers": {
    "libraxis": {
      "command": "npx",
      "args": ["-y", "tsx", "/opt/libraxis/src/mcp/stdio-server.ts"],
      "env": {
        "LIBRAXIS_DB_PATH": "/opt/libraxis/data/libraxis.db",
        "LIBRAXIS_MCP_API_KEY": "<YOUR_API_KEY>"
      }
    }
  }
}
```

### Available MCP Tools

`libraxis_get_context` · `libraxis_list_skills` · `libraxis_load_skill` · `libraxis_create_entry` · `libraxis_update_entry` · `libraxis_log_mistake_with_lesson` · `libraxis_link_entries` · `libraxis_propose_skill_improvement` · `libraxis_list_skill_proposals` · `libraxis_review_skill_proposal` · `libraxis_skill_dashboard` · `libraxis_api_key_create` · `libraxis_api_key_list` · `libraxis_api_key_revoke` · `libraxis_export_entry_markdown` · `libraxis_upload_agent` · `libraxis_list_agents` · `libraxis_load_agent`

Use `libraxis_create_entry` with `type="skill"` for standard skill creation. `libraxis_upload_agent` is reserved for reusable agent packages.

---

## HTTP API Reference

<details>
<summary><strong>Public / Machine API</strong></summary>

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/context` | Query context (`?task=...&limit=...`) |
| `GET` | `/skills` | List skills (`?tags=...&skill_type=...&limit=...`) |
| `GET` | `/skills/:lineageId/load` | Load a skill |
| `GET` | `/agents` | List agents (`?tags=...&limit=...`) |
| `GET` | `/agents/:lineageId/load` | Load an agent |
| `POST` | `/entries` | Create entry |
| `POST` | `/entries/:lineageId/versions` | Add entry version |
| `GET` | `/entries/search` | Search entries (`?q=...&limit=...`) |
| `POST` | `/links` | Create link |
| `POST/GET/DELETE` | `/mcp` | MCP endpoint |

</details>

<details>
<summary><strong>Owner Session Routes</strong></summary>

| Method | Path |
|--------|------|
| `POST` | `/owner/login` |
| `GET` | `/owner/session` |
| `POST` | `/owner/logout` |
| `GET` | `/owner/entries` |
| `GET` | `/owner/entries/:lineageId` |
| `POST` | `/owner/entries` |
| `POST` | `/owner/entries/:lineageId/edit` |
| `DELETE` | `/owner/entries/:lineageId` |
| `POST` | `/owner/agents` |
| `DELETE` | `/owner/agents/:lineageId` |
| `POST` | `/skills/:lineageId/proposals` |
| `GET` | `/proposals` |
| `POST` | `/proposals/:proposalId/review` |
| `GET` | `/skills/dashboard` |

</details>

<details>
<summary><strong>Admin / API Key Routes</strong></summary>

| Method | Path | Scope |
|--------|------|-------|
| `POST` | `/admin/api-keys` | owner session |
| `GET` | `/admin/api-keys` | owner session |
| `POST` | `/admin/api-keys/:keyId/revoke` | owner session |
| `GET` | `/admin/entries/:lineageId/export` | `read` scope |
| `POST` | `/admin/entries` | `write` scope |

</details>

---

## Example Workflows

**Create an entry:**

```bash
curl -s -X POST http://localhost:3000/entries \
  -H 'content-type: application/json' \
  -d '{
    "type":"skill",
    "title":"Incident triage workflow",
    "body_markdown":"Use triage checklist, then escalate with evidence.",
    "metadata":{"skill_type":"workflow"},
    "tags":["ops","triage"]
  }'
```

**Query context:**

```bash
curl -s 'http://localhost:3000/context?task=incident%20triage%20and%20mitigation&limit=10'
```

**List skills:**

```bash
curl -s 'http://localhost:3000/skills?tags=ops,triage&limit=10'
```

---

## Owner Auth and CSRF

Owner writes require a session cookie + CSRF token:

```bash
# 1. Login
curl -i -s -X POST http://localhost:3000/owner/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"change-me"}'

# 2. Read session
curl -s http://localhost:3000/owner/session \
  -H "Cookie: lbx_session=<SESSION_ID>"

# 3. Create API key
curl -s -X POST http://localhost:3000/admin/api-keys \
  -H "Cookie: lbx_session=<SESSION_ID>" \
  -H "x-csrf-token: <CSRF_TOKEN>" \
  -H 'content-type: application/json' \
  -d '{"name":"mcp-http-local","scopes":["read","write"]}'
```

---

## Project Structure

```text
.
├── src/
│   ├── api/
│   ├── auth/
│   ├── config/
│   ├── db/
│   ├── mcp/
│   ├── service/
│   └── web/
├── tests/
├── scripts/
├── data/
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## Development

```bash
npm run lint
npm run test
npm run build
```

Recommended pre-push check:

```bash
npm run lint && npm run test && npm run build
```

---

## Deployment (Docker + Caddy + HTTPS)

<details>
<summary><strong>Full VPS deployment guide</strong></summary>

### Requirements

- Ubuntu 22.04+, domain pointing to VPS IP, ports `22`/`80`/`443` open

### Install dependencies

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin caddy curl jq
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

### Deploy

```bash
sudo mkdir -p /opt/libraxis
sudo chown -R "$USER":"$USER" /opt/libraxis
git clone <YOUR_REPO_URL> /opt/libraxis
cd /opt/libraxis
cp .env.example .env
# Edit .env with production values (NODE_ENV=production, strong credentials)
docker compose up -d --build
curl -fsS http://127.0.0.1:3000/health
```

### HTTPS via Caddy

`/etc/caddy/Caddyfile`:

```caddy
libraxis.your-domain.com {
  reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl restart caddy
curl -fsS https://libraxis.your-domain.com/health
```

### Provision a machine API key

```bash
BASE_URL="https://libraxis.your-domain.com"
COOKIE_JAR="$(mktemp)"

CSRF_TOKEN="$(curl -fsS -c "$COOKIE_JAR" -X POST "$BASE_URL/owner/login" \
  -H 'content-type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" | jq -r '.csrf_token')"

MCP_KEY="$(curl -fsS -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/api-keys" \
  -H 'content-type: application/json' \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -d '{"name":"mcp-http-prod","scopes":["read","write","admin"]}' | jq -r '.plaintext_key')"

rm -f "$COOKIE_JAR"
echo "MCP API key (save now): $MCP_KEY"
```

</details>

---

## Backup and Restore

```bash
./scripts/backup.sh ./data/libraxis.db ./backups
./scripts/restore.sh ./backups/libraxis-YYYYMMDDHHMMSS.db ./data/libraxis.db
```

---

## Security Notes

- Never commit real `.env` credentials
- Use least-privilege API key scopes
- Rotate and revoke machine keys regularly
- Keep `/mcp` behind HTTPS in production
- Owner writes are protected by session cookie + CSRF token

---

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| `AUTH_REQUIRED` on owner routes | Missing `lbx_session` cookie |
| `FORBIDDEN` on owner writes | Missing or wrong `x-csrf-token` |
| MCP session mismatch | API key changed between initialize and follow-up |
| SSL error on local MCP | Use `http://localhost:<PORT>/mcp`, not `https://` without TLS |
| Stdio MCP auth errors | Set `LIBRAXIS_MCP_API_KEY` before `npm run mcp:dev` |

---

## Contributing

Pull requests that modify Libraxis features should include this compliance block:

<details>
<summary><strong>PR compliance template</strong></summary>

```markdown
## Scope
- Feature/Task IDs:
- Spec reference:
- Contracts impacted:

## Constitution Compliance
- [ ] MCP-first flow preserved for primary workflows touched.
- [ ] Unified entries model preserved (or exception documented and approved).
- [ ] Append-only version integrity preserved.
- [ ] Markdown + YAML frontmatter portability preserved.
- [ ] Validation and structured error contracts maintained.
- [ ] Security controls maintained (auth, secret handling, input safety).
- [ ] Required test levels updated and passing.

## Risk Assessment
- Behavioral regressions considered:
- Security implications considered:
- Data migration impact considered:

## Evidence
- Test commands executed:
- Key outputs or artifacts:
- Acceptance checklist updates:
```

</details>

---

## License

[GNU](LICENSE)
