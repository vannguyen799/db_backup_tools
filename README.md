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
| GET | `/api/health` | – | Health probe |

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
- `drive.file` scope means this app can only see files it created — it cannot read your existing Drive contents.

## License

MIT
