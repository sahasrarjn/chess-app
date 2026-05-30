import { Hono } from "hono";
import { cors } from "hono/cors";
import { clampPublicMovetime, parseMovePayload } from "./validation";

export type Env = {
  ENGINE_ORIGIN: string;
  API_KEY?: string;
  PUBLIC_MAX_MOVETIME_MS?: string;
};

const app = new Hono<{ Bindings: Env }>();

/** Below browser timeout; allow cold App Runner + queued moves on a single engine. */
const ENGINE_FETCH_TIMEOUT_MS = 40_000;
const ENGINE_RETRY_STATUSES = new Set([502, 503, 504]);
const ENGINE_RETRY_ATTEMPTS = 2;
const ENGINE_RETRY_DELAY_MS = 400;

async function fetchEngineOnce(
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

async function fetchEngine(url: string, init: RequestInit): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < ENGINE_RETRY_ATTEMPTS; attempt++) {
    const res = await fetchEngineOnce(url, init);
    if (!ENGINE_RETRY_STATUSES.has(res.status) || attempt === ENGINE_RETRY_ATTEMPTS - 1) {
      return res;
    }
    last = res;
    await new Promise((r) => setTimeout(r, ENGINE_RETRY_DELAY_MS * (attempt + 1)));
  }
  return last!;
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
