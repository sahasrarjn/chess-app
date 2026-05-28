# Chess Engine — Cloudflare Worker

Landing page, browser game (`/play/`), iPhone OTA install, and engine API proxy.

```
Browser / iPhone  →  chess-engine.<you>.workers.dev  →  AWS App Runner (Fairy-Stockfish)
```

## Deploy

### 1. Engine backend (AWS App Runner)

```bash
./server/aws/deploy.sh
```

### 2. Cloudflare Worker

```bash
cd server/worker
npm install
npx wrangler secret put ENGINE_ORIGIN
npx wrangler secret put API_KEY
npm run deploy
```

**Public site:** `https://chess-engine.sahasraranjan.workers.dev`

### 3. iPhone app

Engine URL + API key are baked into `Info.plist`. Publish IPA:

```bash
cd ChessBorder
./scripts/release-ios.sh
./scripts/publish-release.sh
npm run deploy   # in server/worker — includes /play/ web build if configured
```

## Local dev

```bash
docker compose -f server/docker-compose.yml up
cd server/worker && npm run dev
```
