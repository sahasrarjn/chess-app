import { Hono } from "hono";
import { cors } from "hono/cors";
import { landingHTML } from "./landing";

export type Env = {
  ENGINE_ORIGIN: string;
  API_KEY?: string;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Env }>();

const apiCors = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "X-API-Key"],
});

app.use("/health", apiCors);
app.use("/v1/*", apiCors);

app.get("/", (c) => c.html(landingHTML));

app.get("/logo.png", (c) => c.env.ASSETS.fetch(c.req.raw));

app.get("/health", async (c) => {
  const origin = c.env.ENGINE_ORIGIN?.replace(/\/$/, "");
  if (!origin) {
    return c.json({ status: "ok", configured: false, engine: "chessborder" });
  }
  try {
    const res = await fetch(`${origin}/health`, { cf: { cacheTtl: 0 } });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (err) {
    return c.json({ status: "error", detail: String(err) }, 502);
  }
});

app.options("/v1/move", (c) => c.body(null, 204));

app.post("/v1/move", async (c) => {
  const origin = c.env.ENGINE_ORIGIN?.replace(/\/$/, "");
  if (!origin) {
    return c.json({ error: "ENGINE_ORIGIN not configured on worker" }, 503);
  }

  // API key is added server-side when proxying; browsers must not need a secret.
  const body = await c.req.text();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (c.env.API_KEY) headers["X-API-Key"] = c.env.API_KEY;

  try {
    const res = await fetch(`${origin}/v1/move`, { method: "POST", headers, body });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (err) {
    return c.json({ error: "Engine origin unreachable", detail: String(err) }, 502);
  }
});

/** API routes above; everything else (e.g. /play/) is served from ASSETS. */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await app.fetch(request, env, ctx);
    if (response.status === 404) {
      return env.ASSETS.fetch(request);
    }
    return response;
  },
};
