# Chess Engine - Cloudflare Worker (API only)

Proxy for `/v1/move` and `/health`. Static site is on **CloudFront + S3** - see [docs/DOMAIN.md](../../docs/DOMAIN.md). Rate limiting is on **CloudFront WAF** (see `server/aws/static-site.yaml`).

```
Browser / iPhone  →  borderchess.org (CloudFront)
                         ├─ /play/ …        → S3
                         └─ /v1/move        → Worker → App Runner
```

## Deploy

### 1. Engine backend (AWS App Runner)

```bash
ALERT_EMAIL=you@example.com ./server/aws/deploy.sh
```

### 2. Static site (S3 + CloudFront) - one-time + on web changes

```bash
./server/aws/deploy-static.sh          # once
./web/scripts/sync-s3-static.sh        # each web release
```

### 3. Cloudflare Worker (API)

```bash
./server/worker/deploy.sh
```

Or all at once: `./scripts/deploy-site.sh`

**Worker URL:** `https://chess-engine.sahasraranjan.workers.dev` (CloudFront origin for API paths)

## Tuning

In `wrangler.toml`:

| Setting | Default | Purpose |
|---------|---------|---------|
| `PUBLIC_MAX_MOVETIME_MS` | `5000` | Cap bot think time for anonymous users |

`/v1/move` rate limits (default ~120 req/min per IP) are set via `WAF_RATE_LIMIT` on the static CloudFront stack — see `server/aws/static-site.yaml`.

## Local dev

```bash
docker compose -f server/docker-compose.yml up
cd server/worker && npm run dev
cd web && npm run dev   # Vite proxies /v1/move to worker
```

## Security

See [SECURITY.md](../../SECURITY.md).
