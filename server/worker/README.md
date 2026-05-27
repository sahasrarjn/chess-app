# Chess Engine — Cloudflare Worker (HTTPS front door)

Public **HTTPS** endpoint for the iPhone app, same pattern as [brain-server](https://brain-server.sahasraranjan.workers.dev/).

Fairy-Stockfish cannot run *inside* Workers (no subprocess, no WASM threads for the full engine). This worker **proxies** to the Docker/App Runner backend where the real engine runs.

```
iPhone app  →  chess-engine.<you>.workers.dev  →  AWS App Runner (Fairy-Stockfish)
                     (free HTTPS)                    (~$6–9/mo)
```

## Deploy

### 1. Engine backend (AWS App Runner)

```bash
./server/aws/deploy.sh
```

Save the **ServiceUrl** and **API key** from the output.

### 2. Cloudflare Worker

```bash
cd server/worker
npm install
npx wrangler secret put ENGINE_ORIGIN   # paste App Runner URL (no trailing slash)
npx wrangler secret put API_KEY         # same key from deploy.sh
npm run deploy
```

Your engine URL for the iPhone app:

`https://chess-engine.sahasraranjan.workers.dev`  
(subdomain matches your Cloudflare account, same as brain-server)

### 3. iPhone app

Home screen → **Engine server**: `https://chess-engine.sahasraranjan.workers.dev`  
**API key**: paste the key from step 1.

## Local dev

```bash
# Terminal 1 — engine
docker compose -f server/docker-compose.yml up

# Terminal 2 — worker proxy
cd server/worker
echo 'ENGINE_ORIGIN=http://127.0.0.1:8080' > .dev.vars
echo 'API_KEY=dev' >> .dev.vars
npm run dev
```

## Cost

| Piece | ~Monthly |
|-------|----------|
| Cloudflare Worker | **$0** (free tier covers personal use) |
| App Runner 0.25 vCPU / 1 GB | **$6–9** |
| **Total** | **~$6–9** |

AWS-only URL works too, but Workers gives you a stable `*.workers.dev` HTTPS URL without managing certificates.
