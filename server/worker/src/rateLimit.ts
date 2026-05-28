export type RateLimitEnv = {
  RATE_LIMIT?: KVNamespace;
  RATE_LIMIT_PER_MINUTE?: string;
};

const DEFAULT_LIMIT = 30;
const WINDOW_SECONDS = 60;

export async function checkRateLimit(
  request: Request,
  env: RateLimitEnv
): Promise<Response | null> {
  if (!env.RATE_LIMIT) return null;

  const limit = parseInt(env.RATE_LIMIT_PER_MINUTE ?? String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(limit) || limit <= 0) return null;

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
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
