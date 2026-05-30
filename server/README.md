# Border Chess - Engine Server

Self-hosted **Fairy-Stockfish** HTTP API for the iPhone app and web bot. Physical iOS devices cannot run the engine locally, so clients call the **Cloudflare worker**, which proxies to this backend.

## Production (recommended)

**Public HTTPS:** [borderchess.org](https://borderchess.org)  
**Private backend:** AWS App Runner (0.5 vCPU, autoscale 1–3, ~$15–35/mo)

```
iPhone / browser  →  Cloudflare Worker  →  App Runner (this server)
                         ↑ rate limit            ↑ X-API-Key (secret)
                         ↑ no client key
```

### Deploy / update

```bash
# 1. Backend (generates API_KEY if unset; stores it in AWS only)
ALERT_EMAIL=you@example.com ./server/aws/deploy.sh

# 2. Worker (syncs ENGINE_ORIGIN + API_KEY secrets, enables rate limiting)
./server/worker/deploy.sh

# 3. Rotate a leaked key (no app rebuild needed)
./scripts/rotate-api-key.sh
```

See [SECURITY.md](../SECURITY.md) for the API key model.

## Quick start (Docker, local)

```bash
docker compose -f server/docker-compose.yml up --build
bash server/test_integration.sh http://localhost:8081
```

Local Docker runs **without** `API_KEY` by default (open on localhost). For parity with production:

```bash
API_KEY=dev-secret docker compose -f server/docker-compose.yml up --build
API_KEY=dev-secret bash server/test_integration.sh http://localhost:8081
```

## Client configuration

| Client | Engine URL | API key |
|--------|------------|---------|
| **iPhone app** | Worker URL in `Info.plist` | None (worker adds it) |
| **Web (production)** | Same origin as `/play/` | None |
| **Web (local dev)** | Empty (Vite proxy) or custom URL | None |

Do **not** put the backend `API_KEY` in mobile apps or browser storage.

## API

| Method | Path | Headers | Body | Response |
|--------|------|---------|------|----------|
| GET | `/health` | - | - | `{"status":"ok","engine_ready":true,...}` |
| POST | `/v1/move` | `X-API-Key` (if `API_KEY` set) | `{ "fen", "elo", "movetime_ms" }` | `{ "uci" }` |

FEN must match the 10×10 `chessborder` variant. Invalid FEN returns `400`.

## Why not engine inside Cloudflare Workers?

Workers have no subprocess and no WASM threads for full Fairy-Stockfish. The worker validates input, rate-limits, and proxies; the real engine runs on App Runner.

Mac app and iOS Simulator continue to use local Fairy-Stockfish when available.
