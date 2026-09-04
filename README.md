# Mongo Backup → Google Drive

Self-hosted service to schedule MongoDB backups (`mongodump --archive --gzip`) and ship them to Google Drive. Built with **Nuxt 4 + Vue 3 + Tailwind v4 + Mongoose + [truxie](https://www.npmjs.com/package/truxie)** (NestJS-style DI backend framework).

Features
- 🔐 Single-admin login (JWT, bcrypt, seeded from env)
- 📦 Per-target MongoDB sources stored encrypted (AES-256-GCM) in Mongo
- ⏱ Cron schedule per target + on-demand "Run Now"
- ☁️ Google Drive upload via OAuth refresh token (`drive.file` scope only)
- 🗑 Retention policy: keep last N or keep N days, auto-deletes old archives
- 🔎 Per-collection filter: pick from a fetched DB tree, or use gitignore-style patterns (`db.tmp_*`). Two modes: `exclude` (backup all except…) or `include` (only these)
- 📊 Dashboard with job history, status, logs, and stats
- 🐳 Docker Compose ready (includes `mongodb-database-tools` in image)

## Quickstart (local dev)

1. Copy env: `cp .env.example .env` and fill in:
   - `JWT_SECRET` — random 32+ chars
   - `ENCRYPTION_KEY` — 64-hex chars (= 32 bytes), generate with `openssl rand -hex 32`
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` — first admin user (seeded on boot)
   - `MONGODB_URI` — Mongo this app uses to store its own config (NOT the targets you back up)
   - Google OAuth keys (see below)
2. Install: `pnpm install`
3. Start: `pnpm dev` → open http://localhost:13280
4. Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`
5. Settings → **Connect Google Drive** (OAuth consent)
6. Targets → **+ New Backup Target** → fill MongoDB URI + cron + Drive folder
7. Hit **Run** to test, or wait for the cron tick

## Google OAuth setup

1. https://console.cloud.google.com/apis/credentials → **Create credentials → OAuth client ID → Web application**
2. Authorized redirect URI: `${APP_URL}/api/gdrive/callback`
   - e.g. local: `http://localhost:13280/api/gdrive/callback`
   - e.g. prod: `https://backup.your-domain.com/api/gdrive/callback`
3. Enable the **Google Drive API** under APIs & Services → Library
4. Put `client_id` / `client_secret` into `.env`
5. (OAuth consent screen): scopes used = `drive.file`, `userinfo.email`, `userinfo.profile`. While the app is in Testing mode, add your Google account to **Test users**, otherwise consent will be blocked.

The app requests `access_type=offline` with `prompt=consent` and stores the resulting refresh token encrypted in Mongo. The access token is auto-refreshed.

## Docker

```bash
cp .env.example .env
# fill JWT_SECRET, ENCRYPTION_KEY, ADMIN_*, GOOGLE_*, APP_URL
docker compose up -d --build
```

The image installs `mongodb-database-tools` (mongodump) and ships with the built Nuxt app.

## Architecture

```
src/
├── server/
│   ├── api/[...].ts                     Catch-all route → truxie dispatcher
│   ├── backend/                         Truxie DI graph
│   │   ├── app.ts                       TruxieFactory.create(AppModule)
│   │   ├── filters/app-error.filter.ts
│   │   ├── guards/auth.guard.ts         JWT bearer guard + @Auth() decorator
│   │   └── modules/
│   │       ├── app.module.ts            Composes all feature modules
│   │       ├── auth/                    login, /me, admin seed
│   │       ├── gdrive/                  OAuth + Drive client + folder mgmt
│   │       ├── backup/                  targets, jobs, runner, scheduler
│   │       └── health/
│   ├── plugins/                         Nitro plugins (env, mongo, app)
│   └── utils/                           crypto, jwt, logger, db connect
├── pages/                               Vue SFC routes
├── components/                          UI components (TargetForm, badges)
├── stores/auth.ts                       Pinia store (JWT in localStorage)
└── middleware/auth.global.ts            Route guard
```

### Why truxie?

- `@Module / @Injectable / @Inject` DI graph (NestJS-style)
- `@Controller('targets') @Get('/:id')` controllers with decorators
- `@RouteGuards(AuthGuard)` for auth at the controller level (`@NoGuard()` per route to opt out)
- `OnApplicationBootstrap` for admin seed + scheduler reload
- `ExceptionFilter` for uniform error responses
- All controllers share one DI container; cross-module exports work out of the box

### API surface

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | – | Email + password → JWT |
| GET | `/api/auth/me` | ✓ | Current user |
| GET | `/api/targets` | ✓ | List targets (URI redacted) |
| POST | `/api/targets` | ✓ | Create target |
| GET | `/api/targets/:id` | ✓ | Get target |
| PATCH | `/api/targets/:id` | ✓ | Update (omit `mongoUri` to keep) |
| DELETE | `/api/targets/:id` | ✓ | Delete target |
| POST | `/api/targets/:id/run` | ✓ | Trigger manual backup (async) |
| POST | `/api/targets/probe-collections` | ✓ | List DBs + collections from a source URI — body: `{mongoUri}` or `{targetId}` |
| GET | `/api/jobs` | ✓ | List jobs (`?targetId=&limit=`) |
| GET | `/api/jobs/recent` | ✓ | Last 20 jobs |
| GET | `/api/jobs/stats` | ✓ | Counts by status + active schedules |
| GET | `/api/jobs/:id` | ✓ | Job detail with full log |
| GET | `/api/gdrive/status` | ✓ | Connected account or `{connected:false}` |
| GET | `/api/gdrive/connect` | ✓ | Returns Google consent URL |
| GET | `/api/gdrive/callback` | – | OAuth callback → redirects to `/settings` |
| POST | `/api/gdrive/disconnect` | ✓ | Revoke local tokens |
| GET | `/api/gdrive/folders` | ✓ | List folders (`?parentId=`) |
| POST | `/api/gdrive/folders` | ✓ | Get-or-create folder |
| GET | `/api/api-keys` | ✓ | List API keys (hash redacted) |
| POST | `/api/api-keys` | ✓ | Mint a key bound to one target — body: `{name, targetId, expiresAt?}`; returns plaintext **once** |
| DELETE | `/api/api-keys/:id` | ✓ | Revoke a key |
| POST | `/api/sync` | 🔑 | Trigger the key's bound target (async) → `{jobId}` |
| POST | `/api/sync/:id` | 🔑 | Trigger target `:id` (must match the key) → `{jobId}` |
| GET | `/api/sync/job/:jobId` | 🔑 | Poll job status (own target only) |
| GET | `/api/health` | – | Health probe |
| POST | `/mcp` | ✓ | MCP endpoint for agents — see [MCP endpoint](#mcp-endpoint-claude-code-and-other-agents) |

Auth legend: **✓** = session JWT (`Authorization: Bearer <jwt>`), **🔑** = API key (`X-API-Key: <key>` or `Authorization: Bearer <key>`), **–** = public.

## Triggering backups from CI/CD

External systems trigger a backup with an API key instead of a user session. A key is **hard-locked to a single target**, so leaking it can only ever back up that one database — never read or trigger anything else.

1. Create a target for the project's DB (UI → Backup Targets, or `POST /api/targets`).
2. UI → **API Keys** → pick the target → **Create key**, and copy the `bk_live_…` value (shown once).
3. Store it as a secret in the other project's CI and call `/api/sync`.

**GitHub Actions** — trigger and wait for success:

```yaml
- name: Back up database
  env:
    BK_HOST: https://backup.example.com
    BK_KEY: ${{ secrets.BACKUP_API_KEY }}
  run: |
    job=$(curl -fsS -X POST "$BK_HOST/api/sync" -H "X-API-Key: $BK_KEY" | jq -r .data.jobId)
    echo "Started job $job"
    for i in $(seq 1 60); do
      sleep 5
      status=$(curl -fsS "$BK_HOST/api/sync/job/$job" -H "X-API-Key: $BK_KEY" | jq -r .data.status)
      echo "status=$status"
      [ "$status" = "success" ] && exit 0
      [ "$status" = "failed" ]  && { echo "Backup failed"; exit 1; }
    done
    echo "Timed out waiting for backup"; exit 1
```

**Fire-and-forget** (any CI, or a plain cron box) — just kick it off:

```bash
curl -fsS -X POST "$BK_HOST/api/sync" -H "X-API-Key: $BK_KEY"
```

## MCP endpoint (Claude Code and other agents)

`POST /mcp` exposes part of this API to an MCP client through [`@truxie/mcp`](https://www.npmjs.com/package/@truxie/mcp). The
client gets **four generic tools** rather than one per route — `list_endpoints`,
`describe_endpoint`, `call_endpoint`, `whoami` — so the catalog is data the model
fetches when it needs it instead of a permanent tax on its context window.

Calls are dispatched in-process through the application's own guard chain
(`matchRoute → guards → pipes → interceptors → handler → filters`). A guard cannot
tell the call arrived over MCP, so nothing is bypassed by using it.

**Auth** — the same dashboard JWT the HTTP API takes:

```bash
TOKEN=$(curl -fsS -X POST http://localhost:13280/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@local","password":"…"}' | jq -r .data.token)
```

The dashboard has a guided version of everything below at **MCP Connection**
(`/mcp-connect`): it shows the endpoint, your current token, ready-made config for
Claude Code / Claude Desktop / Cursor / VS Code, and a **Test connection** button
that runs a real `tools/list` against `/mcp` and prints the catalog you get back.

**Connect Claude Code** — the repo ships a `.mcp.json`; export the token (and the
host, if it is not localhost) and Claude Code picks it up:

```bash
export BACKUP_TOOLS_TOKEN="$TOKEN"
export BACKUP_TOOLS_MCP_URL="https://backup.example.com/mcp"   # optional
```

Or register it globally, without the repo file:

```bash
claude mcp add --transport http backup-tools https://backup.example.com/mcp \
  --header "Authorization: Bearer $TOKEN"
```

Set `MCP_ENABLED=false` to remove the endpoint entirely — it answers 404 then.

### What is exposed

Exposure is opt-in per route, declared with `@McpExpose()` on the controller
method. 14 endpoints are exposed today:

| Exposed | Notes |
|---------|-------|
| `GET /api/health`, `GET /api/auth/me` | Liveness and the acting account |
| `GET /api/targets`, `GET /api/targets/:id` | Target metadata; connection URIs never included |
| `POST /api/targets`, `PATCH /api/targets/:id` | Create and update, with a hand-written body schema in the catalog |
| `POST /api/targets/probe-collections` | Reads the source's databases/collections; changes nothing |
| `POST /api/targets/:id/run` | **dangerous** — `call_endpoint` refuses it until the caller passes `confirm: true` |
| `GET /api/jobs`, `/recent`, `/stats`, `/:id` | Job history and scheduler state |
| `GET /api/gdrive/status`, `/accounts` | Drive connection and account ids |

Deliberately **not** exposed, and the reasons matter more than the list:

- `GET /api/targets/:id/uri` — returns the decrypted connection URI, credentials and all.
- `DELETE /api/targets/:id`, `DELETE /api/gdrive/accounts/:id` — destructive, left to the dashboard.
- `POST /api/auth/login`, `POST /api/auth/change-password` — an agent should not be trading credentials for tokens.
- `POST /api/jobs/:id/download-url`, `GET /api/jobs/:id/download` — hands out the backup archive itself.
- `/api/api-keys/*` and `/api/sync/*` — key management, and the machine-facing trigger that has its own API-key auth.

Adding a route to the catalog is one decorator; a route without it is invisible
and uncallable, so a controller added next month is not reachable by an agent
until someone says it is.

## Restoring a backup

When no collection filter is configured, the backup is a single `mongodump --archive --gzip` file:

```bash
mongorestore --uri="mongodb://restore-target/..." --archive=prod-main__2026-05-15T03-00-00.archive.gz --gzip
```

When a collection filter is configured, the upload is a `.tar` bundle containing one `--archive --gzip` file per DB (or per collection in include mode). Extract then restore each:

```bash
tar -xf prod-main__2026-05-15T03-00-00.tar -C /tmp/restore
for f in /tmp/restore/*.archive.gz; do
  mongorestore --uri="mongodb://restore-target/..." --archive="$f" --gzip
done
```

## Security notes

- The MongoDB URIs you back up live in the config DB **encrypted** (AES-256-GCM, key from `ENCRYPTION_KEY`). Rotate the key by re-saving each target's URI after updating the env.
- Refresh tokens for Drive are encrypted the same way.
- The session token is a 30d JWT signed with `JWT_SECRET`. Set it to a strong random value.
- API keys are stored **SHA-256 hashed** (never in plaintext), each locked to one target, with optional expiry and one-click revoke. Only the non-secret `bk_live_…` prefix is kept for display.
- `drive.file` scope means this app can only see files it created — it cannot read your existing Drive contents.

## License

MIT
