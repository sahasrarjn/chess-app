# Chess Engine — Cloudflare Worker

Public landing page, browser game (`/play/`), and **rate-limited** engine API proxy. iPhone app is coming soon (no public OTA install on the landing page yet).

```
Browser / iPhone  →  chess-engine.<you>.workers.dev  →  AWS App Runner
                         (no client API key)              (X-API-Key secret)
```

## Deploy

### 1. Engine backend (AWS App Runner)

```bash
ALERT_EMAIL=you@example.com ./server/aws/deploy.sh
```

### 2. Cloudflare Worker

```bash
./server/worker/deploy.sh
```

Creates a KV namespace for rate limiting on first deploy and syncs secrets:

- `ENGINE_ORIGIN` — App Runner URL
- `API_KEY` — backend key (never shipped to clients)

**Public site:** `https://borderchess.org` (also `https://chess-engine.sahasraranjan.workers.dev`)

### 3. iPhone app

Only the **worker URL** is baked into `Info.plist` — no API key. Publish IPA:

```bash
cd ChessBorder
./scripts/release-ios.sh
./scripts/publish-release.sh
npm run deploy   # in server/worker — includes /play/ web build if configured
```

## Tuning

In `wrangler.toml`:

| Setting | Default | Purpose |
|---------|---------|---------|
| `PUBLIC_MAX_MOVETIME_MS` | `5000` | Cap bot think time for anonymous users |
| `RATE_LIMIT_PER_MINUTE` | `120` | Max `/v1/move` requests per IP per minute (~60 bot moves with retries) |

## Local dev

```bash
docker compose -f server/docker-compose.yml up
cd server/worker && npm run dev
```

## Security

See [SECURITY.md](../../SECURITY.md).
