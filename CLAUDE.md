# Border Chess — agent notes

GPL v3 monorepo: iOS/Mac (`ChessBorder/`), web (`web/`), Fairy-Stockfish API (`server/`).

## Production architecture

```
borderchess.org (CloudFront + S3 static)
  ├── /, /play/, /privacy, pieces → S3
  └── /v1/move, /health → Cloudflare Worker → AWS App Runner (engine)
```

- **Static stack:** `chess-border-static` (CFN `server/aws/static-site.yaml`)
- **Engine stack:** `chess-border-engine` (CFN `server/aws/template.yaml`) — 0.5 vCPU, autoscale 1–3, MaxConcurrency 8
- **DNS:** Cloudflare zone `borderchess.org`; apex + www must be **grey-cloud CNAME** → `d3ujm85r5zro4r.cloudfront.net` (not orange-cloud proxy)

## Deploy

```bash
./scripts/deploy-site.sh          # engine + S3/CF + worker + verify-site.sh
./web/scripts/sync-s3-static.sh   # static only (set CHESS_STATIC_CF_DISTRIBUTION_ID)
./server/aws/deploy.sh            # App Runner only
./server/worker/deploy.sh         # Cloudflare worker (syncs ENGINE_ORIGIN + API_KEY)
./scripts/rotate-api-key.sh       # new key → App Runner + worker
```

**Secrets (never commit):** repo `.env` (gitignored) may define `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ALERT_EMAIL`. `API_KEY` is generated/stored in AWS; worker gets it via `deploy.sh`.

**App Runner deploy pitfall:** `describe-service` redacts `API_KEY` as the literal string `None`. `server/aws/deploy.sh` must not pass that to CloudFormation — omit `ApiKey` to use previous stack value, or set `API_KEY` explicitly when rotating.

**Cloudflare Worker:** No KV — rate limiting is CloudFront WAF only (`WAF_RATE_LIMIT` in `deploy-static.sh`). After any `server/worker/` change, run `./server/worker/deploy.sh`; git changes alone do not update production bindings. Post-deploy, live bindings should be only `PUBLIC_MAX_MOVETIME_MS` + secrets (`ENGINE_ORIGIN`, `API_KEY`) — no `RATE_LIMIT` KV. Orphan KV namespaces can be deleted in the dashboard or via `wrangler kv namespace delete`.

**DNS fix:** `./scripts/cloudflare-dns-cutover.sh` (auto-sources `.env`). Diagnose: `./scripts/check-dns.sh`. SSL mismatch → [docs/DOMAIN.md](docs/DOMAIN.md).

**Observability:** `./scripts/engine-observability.sh` — CloudWatch logs (30d retention), dashboard `chess-border-engine-engine`, SNS alarms when `ALERT_EMAIL` set at deploy.

## Bot / engine

- **Web:** `web/src/bot/chooseBotMove.ts` — remote engine with retries, then minimax (`chessBot.ts`).
- **iOS:** `HybridBotPlayer` — remote → local Fairy-Stockfish → `ChessBot` minimax.
- **Physical iPhone:** remote only (no local subprocess).
- Clients must **not** embed backend `API_KEY`; worker adds `X-API-Key`.

## Verify after deploy

```bash
./scripts/verify-site.sh
curl -s https://borderchess.org/health
```

## Conventions

- Minimize diff scope; match existing naming and patterns.
- No commits unless asked; no force-push to `main`.
- Only create commits when user requests — use HEREDOC commit messages.
- **Work only on `main`.** Do not create feature branches — commit directly to `main` and push. (Overrides the global "branch first" rule for this repo.)
