import { randomUUID } from "node:crypto";
import { verifyIdToken } from "./idtoken";
import type { IdpIdentity } from "./idtoken";
import {
  parseGameRecordInput,
  parseLoginRequest,
  parseUpdateMeRequest,
  statsKeyFor,
  validateDisplayName,
} from "./protocol";
import type { Profile, Provider } from "./protocol";
import { issueSession, verifySession } from "./session";
import { DynamoUserStore } from "./store";
import type { StoredGame, UserRecord, UserStore } from "./store";
import { resolveUser } from "./users";

/** Subset of APIGatewayProxyEventV2 the handler needs. */
export interface HttpEvent {
  routeKey: string; // e.g. "POST /v1/auth/login", "GET /v1/games/{gameId}"
  headers: Record<string, string | undefined>;
  body?: string | null;
  queryStringParameters?: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined>;
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface HandlerDeps {
  store: UserStore;
  jwtSecret: string;
  /** Allowed audiences per provider (parsed from GOOGLE_CLIENT_IDS / APPLE_CLIENT_IDS). */
  audiences: Record<Provider, string[]>;
  /** Injectable for tests; production uses verifyIdToken with REMOTE_KEYS. */
  verify: (provider: Provider, idToken: string, audience: string[]) => Promise<IdpIdentity>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const JSON_HEADERS = { "content-type": "application/json" };

function json(statusCode: number, body: unknown): HttpResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function bearerToken(headers: Record<string, string | undefined>): string | null {
  const h = headers.authorization ?? headers.Authorization;
  if (!h) return null;
  const match = /^bearer\s+/i.exec(h);
  if (!match) return null;
  const t = h.slice(match[0].length).trim();
  return t.length > 0 ? t : null;
}

function toProfile(user: UserRecord): Profile {
  return {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}

/** Shared auth helper: validate Bearer token and load the user.
 *  Returns { user } on success or { response } with 401 on failure. */
async function authenticate(
  headers: Record<string, string | undefined>,
  store: UserStore,
  jwtSecret: string
): Promise<{ user: UserRecord; response?: never } | { user?: never; response: HttpResponse }> {
  const token = bearerToken(headers);
  if (!token) return { response: json(401, { error: "unauthorized" }) };

  let userId: string;
  try {
    userId = await verifySession(jwtSecret, token);
  } catch {
    return { response: json(401, { error: "unauthorized" }) };
  }

  const user = await store.getUser(userId);
  if (!user) return { response: json(401, { error: "unauthorized" }) };
  return { user };
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

export async function handleRequest(
  event: HttpEvent,
  deps: HandlerDeps,
  now: Date
): Promise<HttpResponse> {
  switch (event.routeKey) {
    case "POST /v1/auth/login": {
      const req = parseLoginRequest(event.body);
      if (!req) return json(400, { error: "invalid request body" });

      const audience = deps.audiences[req.provider];
      if (!audience || audience.length === 0) {
        return json(401, { error: "provider not configured" });
      }

      let identity: IdpIdentity;
      try {
        identity = await deps.verify(req.provider, req.idToken, audience);
      } catch {
        // Security: never log the caught error object — jose errors can carry token claims.
        return json(401, { error: "invalid token" });
      }

      const user = await resolveUser(deps.store, identity, req.name, now);
      const token = await issueSession(deps.jwtSecret, user.userId);
      return json(200, { token, profile: toProfile(user) });
    }

    case "GET /v1/me": {
      const auth = await authenticate(event.headers, deps.store, deps.jwtSecret);
      if (auth.response) return auth.response;
      return json(200, { profile: toProfile(auth.user) });
    }

    case "POST /v1/me": {
      const auth = await authenticate(event.headers, deps.store, deps.jwtSecret);
      if (auth.response) return auth.response;

      const req = parseUpdateMeRequest(event.body);
      if (!req) return json(400, { error: "invalid request body" });

      const displayName = validateDisplayName(req.displayName);
      if (!displayName) return json(400, { error: "invalid displayName" });

      try {
        await deps.store.updateDisplayName(auth.user.userId, displayName);
      } catch {
        // updateDisplayName throws when the user no longer exists (concurrent delete).
        // Re-fetch to confirm; if still missing, return 401.
      }
      const updated = await deps.store.getUser(auth.user.userId);
      // getUser returns null only if the user was concurrently deleted
      if (!updated) return json(401, { error: "unauthorized" });
      return json(200, { profile: toProfile(updated) });
    }

    case "POST /v1/games": {
      const auth = await authenticate(event.headers, deps.store, deps.jwtSecret);
      if (auth.response) return auth.response;

      const req = parseGameRecordInput(event.body);
      if (!req) return json(400, { error: "invalid game record" });

      const endedAt = new Date(
        Math.min(Date.parse(req.endedAt), now.getTime())
      ).toISOString();
      const game: StoredGame = { ...req, endedAt, gameId: randomUUID() };
      await deps.store.putGame(auth.user.userId, game);

      const statKey = statsKeyFor(game);
      if (statKey) {
        try {
          await deps.store.addStat(auth.user.userId, statKey);
        } catch {
          // Stats are best-effort; the GAME# item is the source of truth.
        }
      }
      return json(200, { game });
    }

    case "GET /v1/games": {
      const auth = await authenticate(event.headers, deps.store, deps.jwtSecret);
      if (auth.response) return auth.response;
      const cursor = event.queryStringParameters?.cursor ?? null;
      const page = await deps.store.listGames(auth.user.userId, 20, cursor);
      return json(200, { games: page.games, nextCursor: page.nextCursor });
    }

    case "GET /v1/games/{gameId}": {
      const auth = await authenticate(event.headers, deps.store, deps.jwtSecret);
      if (auth.response) return auth.response;
      const gameId = event.pathParameters?.gameId;
      if (!gameId) return json(404, { error: "not found" });
      const game = await deps.store.getGame(auth.user.userId, gameId);
      if (!game) return json(404, { error: "not found" });
      return json(200, { game });
    }

    default:
      return json(404, { error: "not found" });
  }
}

// ---------------------------------------------------------------------------
// Lambda entry point (lazy singleton store, mirrors multiplayer)
// ---------------------------------------------------------------------------

let prodStore: UserStore | null = null;

export async function handler(event: {
  routeKey: string;
  headers: Record<string, string | undefined>;
  body?: string | null;
  queryStringParameters?: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined>;
}): Promise<HttpResponse> {
  prodStore ??= new DynamoUserStore(process.env.TABLE_NAME ?? "");
  const deps: HandlerDeps = {
    store: prodStore,
    jwtSecret: process.env.JWT_SECRET ?? "",
    audiences: {
      google: splitIds(process.env.GOOGLE_CLIENT_IDS),
      apple: splitIds(process.env.APPLE_CLIENT_IDS),
    },
    verify: (p, t, aud) => verifyIdToken(p, t, aud),
  };
  return handleRequest(event, deps, new Date());
}

function splitIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
