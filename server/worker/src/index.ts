import { Hono } from "hono";
import { cors } from "hono/cors";
import { checkRateLimit } from "./rateLimit";
import { clampPublicMovetime, parseMovePayload } from "./validation";

export type Env = {
  ENGINE_ORIGIN: string;
  API_KEY?: string;
  RATE_LIMIT?: KVNamespace;
  RATE_LIMIT_PER_MINUTE?: string;
  PUBLIC_MAX_MOVETIME_MS?: string;
};

const app = new Hono<{ Bindings: Env }>();

/** Slightly below client fetch timeout so the worker fails fast instead of hanging. */
const ENGINE_FETCH_TIMEOUT_MS = 25_000;

async function fetchEngine(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ENGINE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      return new Response(
        JSON.stringify({ detail: "Engine request timed out" }),
        { status: 504, headers: { "Content-Type": "application/json" } }
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

const apiCors = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type"],
});

app.use("/health", apiCors);
app.use("/v1/*", apiCors);

app.get("/health", async (c) => {
  const origin = c.env.ENGINE_ORIGIN?.replace(/\/$/, "");
  if (!origin) {
    return c.json({ status: "ok", configured: false, engine: "chessborder" });
  }
  try {
    const res = await fetchEngine(`${origin}/health`, { cf: { cacheTtl: 0 } });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return c.json({ status: "error", detail: "Engine origin unreachable" }, 502);
  }
});

app.options("/v1/move", (c) => c.body(null, 204));

app.post("/v1/move", async (c) => {
  const origin = c.env.ENGINE_ORIGIN?.replace(/\/$/, "");
  if (!origin) {
    return c.json({ error: "Engine not configured" }, 503);
  }

  const raw = await c.req.text();
  const parsed = parseMovePayload(raw);
  if ("error" in parsed) {
    return c.json({ error: parsed.error }, 400);
  }

  const limited = await checkRateLimit(c.req.raw, c.env);
  if (limited) return limited;

  const maxMovetime = parseInt(c.env.PUBLIC_MAX_MOVETIME_MS ?? "5000", 10);
  const movetimeMs = clampPublicMovetime(parsed.movetime_ms, maxMovetime);
  const payload = JSON.stringify({ ...parsed, movetime_ms: movetimeMs });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (c.env.API_KEY) headers["X-API-Key"] = c.env.API_KEY;

  try {
    const res = await fetchEngine(`${origin}/v1/move`, {
      method: "POST",
      headers,
      body: payload,
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return c.json({ error: "Engine origin unreachable" }, 502);
  }
});

export default app;
