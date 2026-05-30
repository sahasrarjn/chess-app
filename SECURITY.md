# Security

## Reporting a vulnerability

Email **[sahasraranjan@gmail.com](mailto:sahasraranjan@gmail.com)** privately (do not open a public issue for exploitable bugs). Include steps to reproduce, impact, and any suggested fix.

## Architecture and secrets

Border Chess uses a **two-layer API** for the bot engine:

```
Browser / iPhone  →  CloudFront (borderchess.org)  →  S3 (static)
                              │
                              └─ /v1/move → Cloudflare Worker  →  AWS App Runner
```

| Layer | Who calls it | Authentication |
|-------|----------------|----------------|
| **CloudFront + S3** | Web app (static) | Public HTTPS |
| **Cloudflare Worker** | Web app, iPhone app (bot API) | Public HTTPS; rate limited per IP |
| **App Runner engine** | Cloudflare Worker only | `X-API-Key` header (server-side secret) |

**Clients must not embed the backend API key.** The worker stores `API_KEY` as a Wrangler secret and adds it when proxying to App Runner.

### Rotating the backend API key

```bash
./scripts/rotate-api-key.sh
```

This updates App Runner and the Cloudflare worker. **No iPhone or web rebuild is required** as long as clients keep using the worker URL.

If a key was ever committed to git or shipped in a binary, treat it as compromised and rotate immediately.

## Production controls

- **FEN validation** on worker and App Runner (blocks malformed input and UCI injection)
- **Engine restart** after process failures
- **Health checks** verify the engine responds to `isready`, not just that the HTTP process is up
- **Rate limiting** via Cloudflare KV (120 requests/min/IP by default; tune in `wrangler.toml`)
- **Public movetime cap** on the worker (default 5s) to limit compute abuse
- **CORS disabled** on App Runner unless `ALLOWED_ORIGINS` is explicitly set
- **Non-root** container user for the engine service
- **CloudWatch alarms** (optional `ALERT_EMAIL` on deploy) for 5xx spikes
- **Billing alarm** template in `server/aws/monitoring.yaml`

## Operational checklist before public launch

1. Run `./scripts/rotate-api-key.sh` to invalidate any previously leaked key.
2. Deploy AWS stack with `ALERT_EMAIL=your@email.com ./server/aws/deploy.sh` (or update `AlertEmail` on the existing stack).
3. Deploy worker: `./server/worker/deploy.sh`.
4. Deploy billing alarm (us-east-1): see `server/aws/README.md`.
5. Confirm `/health` returns `engine_ready: true` on the worker URL.
6. Confirm `/v1/move` works without a client `X-API-Key` header (worker adds it server-side).

## Out of scope for v1

- Online multiplayer (no user accounts)
- WAF bot management beyond basic rate limits
- DDoS protection beyond Cloudflare defaults

For higher traffic, add Cloudflare WAF rate limiting rules and increase App Runner capacity.
