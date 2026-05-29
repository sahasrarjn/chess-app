# borderchess.org — DNS setup

The **chess-engine** Cloudflare Worker is already configured with custom domains:

- `borderchess.org`
- `www.borderchess.org`

Deploy config: `server/worker/wrangler.toml` (`[[routes]]` with `custom_domain = true`).

## Your step (Namecheap)

1. [Namecheap](https://www.namecheap.com) → **Domain List** → **Manage** `borderchess.org`
2. **Nameservers** → **Custom DNS**
3. Paste the two nameservers from Cloudflare (**Websites** → `borderchess.org` → overview sidebar)
4. Save

Propagation is usually 15 minutes–2 hours. Cloudflare will show **Active** when ready.

## URLs after DNS is active

| URL | Content |
|-----|---------|
| https://borderchess.org | Landing |
| https://borderchess.org/play/ | Web game |
| https://borderchess.org/privacy | Privacy policy |
| https://borderchess.org/health | Engine health (via worker proxy) |

Legacy workers.dev URL still works: `https://chess-engine.sahasraranjan.workers.dev`

## Redeploy worker (after code changes)

```bash
cd web && npm run sync-worker
cd ../server/worker && npm run deploy
# Or: SYNC_WEB=1 ./server/worker/deploy.sh  (syncs web + secrets + deploy)
```

Or full engine + worker: `./server/aws/deploy.sh` then `./server/worker/deploy.sh`

## Redirect www → apex (Cloudflare dashboard)

Do this manually in Cloudflare so `www.borderchess.org` always serves the same site as `borderchess.org`.

1. Log in to [Cloudflare](https://dash.cloudflare.com) → select zone **borderchess.org**
2. **Rules** → **Redirect Rules** → **Create rule**
3. **Rule name:** `www to apex`
4. **When incoming requests match…**
   - Field: **Hostname**
   - Operator: **equals**
   - Value: `www.borderchess.org`
   - Click **Or** and add:
   - Field: **Wildcard pattern**
   - Operator: **matches**
   - Value: `www.borderchess.org/*`
   - *(Alternatively use a single expression: `http.host eq "www.borderchess.org"` if your plan shows the expression editor.)*
5. **Then…**
   - Type: **Dynamic**
   - Expression: `concat("https://borderchess.org", http.request.uri.path)`
   - Status code: **301** (Permanent Redirect)
6. **Deploy** / **Save**

Quick check after DNS is active:

```bash
curl -sI https://www.borderchess.org/ | grep -i '^location:'
# Expect: location: https://borderchess.org/
```

## Optional: apex → /play/ (homepage shortcut)

Only if you want the bare domain to open the game directly:

- **Rules → Redirect Rules**
- Match: URI path equals `/` on hostname `borderchess.org`
- Redirect to `https://borderchess.org/play/` with **302**
