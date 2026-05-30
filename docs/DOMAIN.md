# borderchess.org - DNS & hosting

## Architecture

```
Browser / iPhone
       │
       ▼
  CloudFront (borderchess.org)  ← AWS S3 static: /, /play/, /privacy, pieces
       │
       ├── /v1/move, /health ──► Cloudflare Worker (workers.dev origin)
       │                              │
       │                              ▼
       │                         AWS App Runner (engine)
       │
       └── everything else ──► S3 bucket
```

- **Static site:** S3 + CloudFront (`server/aws/static-site.yaml`)
- **Bot API:** Cloudflare Worker - rate limiting + API key proxy
- **Engine:** AWS App Runner (private)

## One-time AWS setup

```bash
chmod +x server/aws/deploy-static.sh
./server/aws/deploy-static.sh
```

This creates the S3 bucket, CloudFront distribution, ACM certificate, and optional WAF rate limit.

### DNS in Cloudflare

1. **ACM validation** - add the CNAME records printed by `deploy-static.sh` (wait until certificate status is `ISSUED`).
2. **Site CNAME** - point both hostnames to the CloudFront domain (**DNS only / grey cloud**, not proxied):
   - `borderchess.org` → `dxxxx.cloudfront.net`
   - `www.borderchess.org` → `dxxxx.cloudfront.net`
3. **Remove** old Cloudflare Worker custom-domain routes for `borderchess.org` (already removed from `wrangler.toml`; redeploy worker to apply).

Optional www → apex redirect: CloudFront Function or Cloudflare redirect rule (see previous setup).

### SSL error `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`

Usually **Cloudflare proxy (orange cloud)** on `borderchess.org` while the site is served from **CloudFront**. The browser talks to Cloudflare’s edge with the wrong TLS path to the origin.

**Fix in Cloudflare DNS:**

1. `borderchess.org` → **CNAME** `d3ujm85r5zro4r.cloudfront.net` (**DNS only**, grey cloud, proxy **off**)
2. `www.borderchess.org` → same CNAME, grey cloud
3. Delete stray **A/AAAA** records for the apex that point at Cloudflare (`104.x`, `172.67.x`) or duplicate CloudFront targets
4. **SSL/TLS** mode only matters if you keep proxy on; with grey cloud, TLS is terminated at CloudFront (ACM cert)
5. Remove Worker **custom domains** for `borderchess.org`: `./scripts/detach-worker-domains.sh` (after `npx wrangler login`)

Then flush local DNS (macOS): `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`, hard-refresh Chrome, or try a private window.

`./scripts/verify-site.sh` warns if apex A records still look like Cloudflare proxy IPs.

## Deploy updates

```bash
# Full stack + automated smoke tests
./scripts/deploy-site.sh

# Or step by step:
./server/aws/deploy.sh              # engine
./web/scripts/sync-all-static.sh    # S3 + CloudFront
./server/worker/deploy.sh           # API worker
./scripts/verify-site.sh            # smoke test
```

## URLs

| URL | Served by |
|-----|-----------|
| https://borderchess.org | CloudFront → S3 landing |
| https://borderchess.org/play/ | CloudFront → S3 game |
| https://borderchess.org/privacy | CloudFront → S3 |
| https://borderchess.org/v1/move | CloudFront → Worker → App Runner |
| https://borderchess.org/ChessBorder/pieces/ | CloudFront → S3 |

Worker direct URL (debug): `https://chess-engine.sahasraranjan.workers.dev`

## Environment (.env)

```bash
CHESS_STATIC_BUCKET=borderchess-static-ACCOUNTID   # optional; auto from stack
CHESS_STATIC_CF_DISTRIBUTION_ID=E123...            # optional; auto from stack
ENABLE_WAF=true                                    # deploy-static.sh
WAF_RATE_LIMIT=600                                 # ~120 req/min per IP on /v1/move
```

## Tear down static stack

```bash
# Empty bucket first
aws s3 rm s3://borderchess-static-ACCOUNTID --recursive
aws cloudformation delete-stack --stack-name chess-border-static --region us-east-1
```
