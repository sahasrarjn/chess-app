export type RateLimitEnv = {
  RATE_LIMIT?: KVNamespace;
  RATE_LIMIT_PER_MINUTE?: string;
};

/** Applied only after FEN/payload validation so junk POSTs skip KV. ~1 req per bot move; web retries once on bad UCI. */
const DEFAULT_LIMIT = 120;
const WINDOW_SECONDS = 60;

/** Client IP from Cloudflare edge or CloudFront → Worker origin. */
export function clientIp(request: Request): string {
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf) return cf;

  const xff = request.headers.get("X-Forwarded-For");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  const viewer = request.headers.get("CloudFront-Viewer-Address");
  if (viewer) {
    // IPv4 "1.2.3.4:12345" or bracketed IPv6
    if (viewer.startsWith("[")) {
      const end = viewer.indexOf("]");
      if (end > 1) return viewer.slice(1, end);
    }
    const colon = viewer.lastIndexOf(":");
    if (colon > 0 && viewer.indexOf(":") === colon) return viewer.slice(0, colon);
    return viewer;
  }

  return "unknown";
}

export async function checkRateLimit(
  request: Request,
  env: RateLimitEnv
): Promise<Response | null> {
  if (!env.RATE_LIMIT) return null;

  const limit = parseInt(env.RATE_LIMIT_PER_MINUTE ?? String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(limit) || limit <= 0) return null;

  const ip = clientIp(request);
  const key = `move:${ip}`;
  const currentRaw = await env.RATE_LIMIT.get(key);
  const current = currentRaw ? parseInt(currentRaw, 10) : 0;

  if (current >= limit) {
    return Response.json(
      { error: "Rate limit exceeded", retry_after_seconds: WINDOW_SECONDS },
      {
        status: 429,
        headers: {
          "Retry-After": String(WINDOW_SECONDS),
          "Content-Type": "application/json",
        },
      }
    );
  }

  await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: WINDOW_SECONDS });
  return null;
}
