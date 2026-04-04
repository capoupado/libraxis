# Libraxis

Libraxis is a local-first knowledge and skills platform for people and agents.

## What You Get

- Fastify HTTP API for entries, context, skills, proposals, owner workflows, and admin operations
- MCP support over Streamable HTTP (`/mcp`) and stdio
- React web app for owner login, curation, API key management, proposals, and agents
- SQLite storage with append-only versioning

## Prerequisites

- Node.js 20+
- npm 10+
- Linux or macOS shell (Windows works with equivalent commands)

Check versions:

```bash
node -v
npm -v
```

## Quick Start (Local)

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

Open:

- Web UI: `http://localhost:5173`
- API health: `http://localhost:3000/health`

## Environment Variables

`.env.example` includes defaults for local development.

```dotenv
NODE_ENV=development
PORT=3000
LIBRAXIS_DB_PATH=./data/libraxis.db
LIBRAXIS_ADMIN_USERNAME=admin
LIBRAXIS_ADMIN_PASSWORD=change-me
LIBRAXIS_SESSION_TTL_DAYS=7
LIBRAXIS_MCP_API_KEY=
```

Optional for web dev proxy override:

```dotenv
LIBRAXIS_BACKEND_URL=http://localhost:3000
```

Production rule: default owner credentials are rejected when `NODE_ENV=production`.

## Runtime Modes

### HTTP API + Web UI

- Backend: `npm run dev`
- Web: `npm run web:dev`
- Build backend: `npm run build`
- Run compiled backend: `npm run start`

### MCP over HTTP (Recommended)

Endpoint:

- Local: `http://localhost:<PORT>/mcp`
- VPS: `https://<your-domain>/mcp`

Authentication headers:

- `Authorization: Bearer <YOUR_API_KEY>`
- or `x-api-key: <YOUR_API_KEY>`

MCP client example:

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

Important behavior:

- Initialize and follow-up session calls must use the same API key.
- Local default server is plain HTTP; `http://localhost:<PORT>/mcp` fails unless you add TLS termination.

### MCP over stdio (Fallback)

```bash
export LIBRAXIS_MCP_API_KEY=<YOUR_API_KEY>
npm run mcp:dev
```

Compiled mode:

```bash
npm run build
npm run mcp:start
```

Stdio client example:

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

## Owner Auth and CSRF

Owner writes require:

- `Cookie: lbx_session=<session-id>`
- `x-csrf-token: <csrf-token>`

Login example:

```bash
curl -i -s -X POST http://localhost:3000/owner/login \
	-H 'content-type: application/json' \
	-d '{"username":"admin","password":"change-me"}'
```

Read session:

```bash
curl -s http://localhost:3000/owner/session \
	-H "Cookie: lbx_session=<SESSION_ID>"
```

## Core HTTP Endpoints

### Public / Machine API

- `GET /health`
- `GET /context?task=...&limit=...`
- `GET /skills?tags=...&skill_type=...&limit=...`
- `GET /skills/:lineageId/load`
- `GET /agents?tags=...&limit=...`
- `GET /agents/:lineageId/load`
- `POST /entries`
- `POST /entries/:lineageId/versions`
- `GET /entries/search?q=...&limit=...`
- `POST /links`
- `POST /mcp` `GET /mcp` `DELETE /mcp`

### Owner Session Routes

- `POST /owner/login`
- `GET /owner/session`
- `POST /owner/logout`
- `GET /owner/entries`
- `GET /owner/entries/:lineageId`
- `POST /owner/entries`
- `POST /owner/entries/:lineageId/edit`
- `DELETE /owner/entries/:lineageId`
- `POST /owner/agents`
- `DELETE /owner/agents/:lineageId`
- `POST /skills/:lineageId/proposals`
- `GET /proposals`
- `POST /proposals/:proposalId/review`
- `GET /skills/dashboard` (currently returns disabled payload)

### Admin/API Key Routes

- `POST /admin/api-keys`
- `GET /admin/api-keys`
- `POST /admin/api-keys/:keyId/revoke`
- `GET /admin/entries/:lineageId/export` (requires `x-api-key` read scope)
- `POST /admin/entries` (requires `x-api-key` write scope)

## Example Workflows

### Create an entry

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

### Query context

```bash
curl -s 'http://localhost:3000/context?task=incident%20triage%20and%20mitigation&limit=10'
```

### List skills

```bash
curl -s 'http://localhost:3000/skills?tags=ops,triage&limit=10'
```

### Create API key (owner session + csrf)

```bash
curl -s -X POST http://localhost:3000/admin/api-keys \
	-H "Cookie: lbx_session=<SESSION_ID>" \
	-H "x-csrf-token: <CSRF_TOKEN>" \
	-H 'content-type: application/json' \
	-d '{"name":"mcp-http-local","scopes":["read","write"]}'
```

## MCP Tools Exposed

- `libraxis_get_context`
- `libraxis_list_skills`
- `libraxis_load_skill`
- `libraxis_create_entry`
- `libraxis_update_entry`
- `libraxis_log_mistake_with_lesson`
- `libraxis_link_entries`
- `libraxis_propose_skill_improvement`
- `libraxis_list_skill_proposals`
- `libraxis_review_skill_proposal`
- `libraxis_skill_dashboard`
- `libraxis_api_key_create`
- `libraxis_api_key_list`
- `libraxis_api_key_revoke`
- `libraxis_export_entry_markdown`
- `libraxis_upload_agent`
- `libraxis_list_agents`
- `libraxis_load_agent`

## Backup and Restore

```bash
./scripts/backup.sh ./data/libraxis.db ./backups
./scripts/restore.sh ./backups/libraxis-YYYYMMDDHHMMSS.db ./data/libraxis.db
```

## VPS Deployment (Docker + Caddy + HTTPS)

### 1) VPS requirements

- Ubuntu 22.04+
- Domain pointing to VPS IP
- Open ports `22`, `80`, `443`

### 2) Install dependencies

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin caddy curl jq
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

### 3) Deploy app

```bash
sudo mkdir -p /opt/libraxis
sudo chown -R "$USER":"$USER" /opt/libraxis
git clone <YOUR_REPO_URL> /opt/libraxis
cd /opt/libraxis
cp .env.example .env
```

Use production-safe values in `.env`:

```dotenv
NODE_ENV=production
PORT=3000
LIBRAXIS_DB_PATH=./data/libraxis.db
LIBRAXIS_ADMIN_USERNAME=<STRONG_USERNAME>
LIBRAXIS_ADMIN_PASSWORD=<STRONG_PASSWORD>
```

Start:

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:3000/health
```

### 4) Add HTTPS reverse proxy

`/etc/caddy/Caddyfile`:

```caddy
libraxis.your-domain.com {
	reverse_proxy 127.0.0.1:3000
}
```

Apply and validate:

```bash
sudo systemctl restart caddy
curl -fsS https://libraxis.your-domain.com/health
```

### 5) Provision machine API key

```bash
BASE_URL="https://libraxis.your-domain.com"
ADMIN_USER="<OWNER_USERNAME>"
ADMIN_PASS="<OWNER_PASSWORD>"

COOKIE_JAR="$(mktemp)"

CSRF_TOKEN="$({
	curl -fsS -c "$COOKIE_JAR" -X POST "$BASE_URL/owner/login" \
		-H 'content-type: application/json' \
		-d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}";
} | jq -r '.csrf_token')"

MCP_KEY="$({
	curl -fsS -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/api-keys" \
		-H 'content-type: application/json' \
		-H "x-csrf-token: $CSRF_TOKEN" \
		-d '{"name":"mcp-http-prod","scopes":["read","write","admin"]}';
} | jq -r '.plaintext_key')"

rm -f "$COOKIE_JAR"
echo "MCP API key (save now): $MCP_KEY"
```

## Project Structure

```text
.
|- src/
|  |- api/
|  |- auth/
|  |- config/
|  |- db/
|  |- mcp/
|  |- service/
|  |- web/
|- tests/
|- scripts/
|- data/
|- Dockerfile
|- docker-compose.yml
|- package.json
```

## Development and Validation

```bash
npm run lint
npm run test
npm run build
```

Recommended pre-push check:

```bash
npm run lint && npm run test && npm run build
```

## Security Notes

- Never commit real `.env` credentials.
- Use least-privilege API key scopes.
- Rotate and revoke machine keys regularly.
- Keep `/mcp` behind HTTPS in production.
- Keep owner writes protected by session cookie + CSRF token.

## Troubleshooting

- `AUTH_REQUIRED` on owner routes: missing `lbx_session` cookie.
- `FORBIDDEN` on owner writes: missing or wrong `x-csrf-token`.
- MCP session mismatch: API key changed between initialize and follow-up requests.
- SSL error on local MCP: use `http://localhost:<PORT>/mcp`, not `https://...` without TLS termination.
- Stdio MCP auth errors: set `LIBRAXIS_MCP_API_KEY` before `npm run mcp:dev`.

## Compliance Statement Template (PR Use)

Use this block in pull requests that modify Libraxis features.

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