# Border Chess — Web

Browser version of Border Chess: **Play vs Bot** and **Play with Friend** (pass-and-play). Same 10×10 border board and rules as the iOS/Mac app. No online matchmaking.

## Run locally

```bash
# Terminal 1 — engine API (required for bot)
docker compose -f server/docker-compose.yml up --build

# Terminal 2 — web dev server (proxies /v1/move to localhost:8080)
cd web
npm install
npm run dev
```

Open http://localhost:5173/play/

## Production build

```bash
cd web
npm run build
```

Output is in `web/dist/`. To bundle with the Cloudflare worker:

```bash
cd web && npm run build
rm -rf ../server/worker/public/play
mkdir -p ../server/worker/public/play
cp -r dist/* ../server/worker/public/play/
cp -r public/pieces ../server/worker/public/play/pieces
cp public/logo.png ../server/worker/public/play/logo.png
```

Then deploy the worker (`server/worker`). The game is served at `/play/`.

## Bot engine

The web client calls the same HTTP API as the iPhone app:

- `POST /v1/move` — body: `{ fen, elo, movetime_ms }`
- `GET /health`

By default (empty engine URL in settings), requests go to the **same origin** as the page. In dev, Vite proxies those paths to `http://127.0.0.1:8081`. On the worker, `/v1/move` is validated, rate-limited, and proxied to `ENGINE_ORIGIN`.

Optional **Engine settings** (local dev): custom server URL. Production does not need an API key in the browser — the worker adds it server-side.

## Stack

- TypeScript game engine (ported from Swift `ChessGame.swift`)
- Vite + vanilla DOM UI
- Lichess Maestro piece SVGs (same as the app)
