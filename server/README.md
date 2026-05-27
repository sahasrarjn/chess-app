# Chess Border — Engine Server

Self-hosted **Fairy-Stockfish** HTTP API for the iPhone app. Physical iOS devices cannot run the engine locally, so the app calls this server instead of using minimax.

## Production (recommended)

**HTTPS front door:** [chess-engine.sahasraranjan.workers.dev](https://chess-engine.sahasraranjan.workers.dev) (Cloudflare Worker, free)  
**Engine backend:** AWS App Runner (~$6–9/mo) — Fairy-Stockfish in Docker

The iPhone app ships with the workers.dev URL in `Info.plist`. Enter the API key once on the home screen.

```bash
# Redeploy worker after AWS stack changes
API_KEY=your-key ./server/worker/deploy.sh
```

See [server/worker/README.md](worker/README.md) and [server/aws/](aws/) for details.

## Quick start (Docker, local)

```bash
docker compose -f server/docker-compose.yml up --build
```

Test:

```bash
curl http://localhost:8080/health

curl -X POST http://localhost:8080/v1/move \
  -H 'Content-Type: application/json' \
  -d '{
    "fen": "........../.rnbqkbnr./.pppppppp./......../......../......../......../.PPPPPPPP./.RNBQKBNR./.......... w KQkq - 0 1",
    "elo": 1600,
    "movetime_ms": 300
  }'
```

Response: `{"uci":"e2e4"}` (engine uses 10×10 coordinates, e.g. `h9g7` for Nf6).

## iPhone app configuration

Default URL (already in `Info.plist`):

`https://chess-engine.sahasraranjan.workers.dev`

On the home screen, paste your **API key** under **Engine server** (same key as AWS / worker secrets).

## API

| Method | Path | Headers | Body | Response |
|--------|------|---------|------|----------|
| GET | `/health` | — | — | `{"status":"ok",...}` |
| POST | `/v1/move` | `X-API-Key` (if configured) | `{ "fen", "elo", "movetime_ms" }` | `{ "uci" }` |

## Why not engine inside Cloudflare Workers?

Workers have no subprocess and no WASM threads for full Fairy-Stockfish. The worker is a thin HTTPS proxy; the real engine runs on App Runner.

Mac app and iOS Simulator continue to use local Fairy-Stockfish when available.
