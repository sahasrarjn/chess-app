# Leaderboard (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public `GET /v1/leaderboard` returns the top 100 players ranked by **online wins** (server-authoritative `online_w` counters written by the multiplayer Lambda since Phase 3), cacheable ~60s. Signed-in callers additionally get a `me` entry — their own row (pinned client-side when outside the top 100) plus their full private stats map (per-difficulty bot W/L/D + online W/L/D), shown in a "Your stats" section at the top of a new Leaderboard screen on web + iOS. Ranking is maintained by a `LEADERBOARD` GSI on the existing users table whose sort key is refreshed by the multiplayer Lambda whenever an online win is recorded.

**Architecture:** Phase 4 EXTENDS the Phase 2/3 accounts Lambda and `chess-border-users` table — no new stack. The `USER#<id>/META` item gains two attributes, `LBPK` (constant `"LB"`) and `LBSK` (`W#<wins zero-padded 8>#<userId>`), indexed by a new GSI `LEADERBOARD` with an INCLUDE projection of `displayName`, `avatarUrl`, `stats`. The multiplayer Lambda's `record.ts` (the only place `online_w` increments) sets `LBPK`/`LBSK` after each win; the accounts Lambda only reads (Query on the GSI, `ScanIndexForward: false`, `Limit: 100`).

**Tech Stack:** TypeScript + `node:test` via `tsx` (server + web), vanilla TS controllers (web), SwiftUI + ViewModels (iOS), CloudFormation + bash deploy scripts (infra), `xcodegen` for project regeneration.

**Branch:** `leaderboard` off `main`. Spec: `docs/superpowers/specs/2026-06-11-production-features-design.md` (Phase 4).

**Conventions:** imperative commit subjects, no `feat:` prefixes, HEREDOC commit messages, NO Claude co-author trailer. Minimize diff scope; match existing naming/patterns per package.

**Known baselines (verify before starting, re-verify at the end):**
- `server/accounts`: 139 tests pass
- `server/multiplayer`: 44 tests pass
- `web`: 128 tests pass
- Mac suite (`xcodebuild -scheme ChessBorderMac test`): 59 tests with exactly ONE pre-existing failure (OnlineTests border-move) — do not "fix" it, do not add to it
- iOS simulator build succeeds (`-scheme ChessBorder -destination 'generic/platform=iOS Simulator'`)

---

## Settled decisions encoded in this plan (do not relitigate)

- **GSI on the META item, not a separate item.** `LBPK`/`LBSK` live on `USER#<id>/META` — the same item `addStat` already mutates — so the GSI's INCLUDE projection (`displayName`, `avatarUrl`, `stats`) stays automatically in sync: DynamoDB maintains projected non-key attributes on every item update. Consequence: a loss or draw (which only `ADD`s `stats.online_l/d`) refreshes the projected games count **without touching `LBSK`**, and a display-name change propagates to the board with **no leaderboard-specific code in the accounts handler**.
- **`LBSK` changes ONLY on an online win.** Ranking is wins-only, so losses/draws can't reorder anyone; games-played freshness rides on the projection (above). Users with **zero online wins never get `LBPK` and are not on the board** — by design (wins-ranked). A player with 10 losses and 0 wins is invisible; accepted and flagged.
- **The atomic increment problem, spelled out:** DynamoDB cannot `SET LBSK` from the post-`ADD` value in one UpdateExpression (`SET` operands can't reference the result of an `ADD` in the same request). Mechanics:
  1. **Update 1** — the existing `ADD stats.#k :one` gains `ReturnValues: "UPDATED_NEW"`. For a nested path, `UPDATED_NEW` returns only the modified portion: `Attributes = { stats: { online_w: <new count> } }`. `addStat` on the multiplayer `UserGamesWriter` changes from `Promise<void>` to `Promise<number>`.
  2. **Update 2** (wins only) — `SET LBPK = :lb, LBSK = :sk` where `:sk` is computed client-side from the returned count, guarded by `ConditionExpression: attribute_exists(PK) AND (attribute_not_exists(LBSK) OR LBSK < :sk)`. Because the zero-padding is fixed-width and the `userId` suffix is constant for a given user, lexicographic `<` on `LBSK` equals numeric `<` on wins — so two racing wins both count (ADD is atomic) and the **higher** `LBSK` always survives regardless of arrival order. A `ConditionalCheckFailedException` means a newer count already landed; it is swallowed.
- **Counter capacity:** wins are zero-padded to 8 digits (`W#00000042#<userId>`), clamped to `99_999_999`. Tie-break at equal wins is `userId` descending (lexicographic, inherent in the SK) — arbitrary but stable; documented, not configurable.
- **The canonical GSI key contract lives in the accounts store.** `UserStore` gains `setLeaderboardEntry(userId, wins)` + `getLeaderboard(limit)` with both impls. The accounts Lambda never calls `setLeaderboardEntry` in production (the multiplayer Lambda is the only writer), but keeping it beside the reader (a) co-locates the `lbsk()` format with the Query that depends on it, (b) gives `InMemoryUserStore` a way to seed board state for handler tests, and (c) is the reference the multiplayer `DynamoUserGamesWriter` deliberately duplicates — same reasoning as the Phase 3 `putGame`/`addStat` duplication (two independently deployed Lambdas, no shared package until a third consumer appears).
- **Existing users appear lazily.** Items enter the GSI only once `LBPK`/`LBSK` are set, i.e. on each user's next online win. There are ~0 real users today, so no backfill script is built; if it ever matters, a one-off scan that sets `lbsk(stats.online_w)` on every META item with `online_w > 0` is trivial. Flagged, not built.
- **`GET /v1/leaderboard` is PUBLIC** (no auth required; route registered like the others — API GW HTTP API CORS already allows GET from the site origins). Response: `{entries, me}`.
  - `entries`: top 100 from the GSI, each `{rank, displayName, avatarUrl, wins, games}`. **No `userId` in the public payload** (don't leak internal IDs); the client highlights the caller's own row via `me.rank` instead. `wins`/`games` are computed from the projected `stats` map (`online_w`, `online_w+online_l+online_d`) — display values come from the always-current projection, *order* comes from `LBSK`; during a write race a row can momentarily display one more win than its position implies. Accepted (self-heals on the next read after Update 2 lands).
  - `bot_*` counters ride along in the projected `stats` map but are **stripped server-side** — bot stats never appear for anyone but the caller themself.
  - `me`: present when a **valid** Bearer token accompanies the request: `{rank, displayName, avatarUrl, wins, games, stats}` where `rank` is the 1-based position when the caller is in the fetched top 100 and `null` otherwise, and `stats` is the caller's full flat map (powers "Your stats"). Computing an exact rank beyond 100 would require counting GSI items ahead of the caller's `LBSK` — a paged Select=COUNT Query — and the spec only asks for "pinned if outside top 100", so this plan consciously narrows: outside the top 100 the client shows "—" for rank. Flagged.
  - **An invalid/expired token degrades to the anonymous response (`me: null`), never 401** — the board is public; a stale session shouldn't blank the screen.
- **Caching:** anonymous responses get `Cache-Control: public, max-age=60`; authenticated ones get `private, max-age=60`; both get `Vary: Authorization` so no shared cache ever serves a `me`-bearing body to another caller. The `json()` helper gains an optional extra-headers parameter.
- **"Your stats" lives at the top of the Leaderboard screen** when signed in (web + iOS) — one screen, no new nav, no auth-widget changes. Rows: Online W/L/D, then Bot easy/medium/hard W/L/D; zero-game rows are omitted. Bot stats come from `me.stats`, so they are visible only to the owner (spec requirement).
- **Client behavior:** screen reachable from Home (button/NavigationLink beside Past Games, same secondary styling). Table columns: rank, name (+avatar when present), wins, games, win rate (`round(w/g*100)%`, "—" when 0 games). Own row highlighted when `me.rank != null`; pinned `me` row below the table when `me.rank == null && me.games > 0`. Manual reload only (no auto-refresh) — the 60s cache makes polling pointless anyway.
- **No new IAM for the multiplayer Lambda** (`UpdateItem` on the users table already granted in Phase 3; GSI writes are implicit in table writes). The **accounts** Lambda's `dynamodb:Query` must additionally cover the index ARN — querying a GSI authorizes against `table/<name>/index/<index>`, not the table ARN. The policy `Resource` becomes a list adding `!Sub "${UsersTable.Arn}/index/*"`.
- **CFN GSI mechanics:** adding a GSI to the existing CFN-managed table is an in-place UPDATE (table stays available; index backfills in minutes; only one GSI addition per stack update — this plan adds exactly one). `LBPK`/`LBSK` must be added to `AttributeDefinitions` in the same update. PAY_PER_REQUEST ⇒ no provisioned-throughput block on the GSI. Attributes written before the index finishes creating are picked up by the backfill, so deploy order is forgiving — but deploy accounts (GSI + route) before multiplayer anyway.
- **`ADD stats.#k :one` precondition** (`stats` map must exist) is already guaranteed: every user since Phase 2 is created with `stats: {}` (see `resolveUser`/`putUser`), and Phase 3 ships the same expression in production.
- **Self-play edge** (both seats the same signed-in user): the win seat triggers `addStat("online_w")` + `setLeaderboardEntry`, the loss seat only `addStat("online_l")` — consistent with Phase 3's accepted +1w/+1l on the same user.

## File Structure

| File | Responsibility |
|---|---|
| `server/accounts/src/protocol.ts` (modify) | `LeaderboardEntry`/`LeaderboardMe`/`LeaderboardResponse` types, `onlineTotals`. |
| `server/accounts/src/protocol.test.ts` (modify) | `onlineTotals` tests. |
| `server/accounts/src/store.ts` (modify) | `LeaderboardRow`, `lbsk`, `setLeaderboardEntry` + `getLeaderboard` on `UserStore` + both impls. |
| `server/accounts/src/store.test.ts` (modify) | Ordering/tie-break/limit/monotonic-guard tests on `InMemoryUserStore`. |
| `server/accounts/src/handler.ts` (modify) | Route `GET /v1/leaderboard`; `json()` gains optional headers. |
| `server/accounts/src/handler.test.ts` (modify) | Public access, top-100 shape, `me` logic, cache headers, bot-stat privacy. |
| `server/aws/accounts.yaml` (modify) | `LEADERBOARD` GSI + `LBPK`/`LBSK` attribute defs; `LeaderboardRoute`; IAM index ARN. |
| `server/multiplayer/src/record.ts` (modify) | `addStat` returns the new count; `setLeaderboardEntry`; win hook in `recordFinishedGame`. |
| `server/multiplayer/src/record.test.ts` (modify) | FakeWriter signature update; LBSK-on-win-only tests. |
| `server/multiplayer/src/handler.test.ts` (modify) | FakeWriter signature update only (compile fix). |
| `web/src/auth/leaderboardApi.ts` (create) | `fetchLeaderboard` (optional Bearer) + response types. |
| `web/src/auth/leaderboardApi.test.ts` (create) | Request-shape (with/without token) + error tests. |
| `web/src/ui/leaderboardView.ts` (create) | Leaderboard screen + exported pure helpers `winRateText`, `statLines`. |
| `web/src/ui/leaderboardView.test.ts` (create) | Pure-helper tests (no DOM). |
| `web/src/ui/home.ts` (modify) | "Leaderboard" action + `onLeaderboard` callback. |
| `web/src/main.ts` (modify) | `showLeaderboard` route. |
| `web/src/styles.css` (modify) | `.leaderboard*` styles. |
| `ChessBorder/ChessBorder/Auth/AccountsAPI.swift` (modify) | `LeaderboardEntry`/`LeaderboardMe`/`LeaderboardResponse` Codables + `leaderboard(token:)`. |
| `ChessBorder/ChessBorder/Views/LeaderboardView.swift` (create) | Leaderboard screen mirroring `PastGamesView` chrome. |
| `ChessBorder/ChessBorder/Views/HomeView.swift` (modify) | "Leaderboard" NavigationLink. |
| `ChessBorder/ChessBorderTests/LeaderboardTests.swift` (create) | Decode fixtures (Mac-runnable). |
| `scripts/verify-site.sh` (modify, final task) | `GET /v1/leaderboard` → 200 + `"entries"` smoke check. |

## API contract (single source of truth for all packages)

```
GET /v1/leaderboard          PUBLIC; Authorization: Bearer <session JWT> optional
→ 200 {
    entries: [                       // top 100, online-wins descending
      { rank: number,                // 1-based
        displayName: string,
        avatarUrl: string | null,
        wins: number,                // stats.online_w
        games: number }              // online_w + online_l + online_d
    ],
    me: null | {                     // null when anonymous OR token invalid/expired
      rank: number | null,           // null ⇒ outside the fetched top 100
      displayName: string,
      avatarUrl: string | null,
      wins: number,
      games: number,
      stats: Record<string, number>  // caller's full flat map (bot_* + online_*) — own profile only
    }
  }
Headers: Cache-Control: public, max-age=60 (me == null) | private, max-age=60 (me != null)
         Vary: Authorization
Never 401; never exposes userId or anyone else's bot_* counters.
```

DynamoDB (`chess-border-users`):

```
USER#<userId> / META  gains  LBPK = "LB"                          (constant partition)
                             LBSK = "W#<wins padStart(8,'0')>#<userId>"
GSI LEADERBOARD: HASH LBPK, RANGE LBSK,
                 Projection INCLUDE [displayName, avatarUrl, stats]
Written only by the multiplayer Lambda on online wins (monotonic LBSK < :sk guard).
Read only by the accounts Lambda (Query, ScanIndexForward=false, Limit=100).
```

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/sahasra/Personal/work/chess-app
git checkout main && git pull && git checkout -b leaderboard
```

- [ ] **Step 2: Capture baselines** (expect 139 / 44 / 128 passing):

```bash
(cd server/accounts && npm test 2>&1 | grep -E '^. (pass|fail) ')
(cd server/multiplayer && npm test 2>&1 | grep -E '^. (pass|fail) ')
(cd web && npm test 2>&1 | grep -E '^. (pass|fail) ')
```

---

### Task 1: Accounts protocol — leaderboard types + onlineTotals (TDD)

**Files:** modify `server/accounts/src/protocol.ts`, `server/accounts/src/protocol.test.ts`.

- [ ] **Step 1: Write failing tests** for `onlineTotals`:
1. `{online_w: 3, online_l: 2, online_d: 1, bot_easy_w: 9}` → `{wins: 3, games: 6}` (bot keys ignored).
2. `{}` → `{wins: 0, games: 0}`; partial map `{online_l: 4}` → `{wins: 0, games: 4}`.

- [ ] **Step 2: Implement** — append to `protocol.ts` (full code):

```ts
// ---------------------------------------------------------------------------
// Leaderboard (Phase 4)
// ---------------------------------------------------------------------------

/** Public leaderboard row. Deliberately carries no userId. */
export interface LeaderboardEntry {
  rank: number; // 1-based
  displayName: string;
  avatarUrl: string | null;
  wins: number;
  games: number;
}

/** The caller's own entry. rank is null when outside the fetched top 100. */
export interface LeaderboardMe {
  rank: number | null;
  displayName: string;
  avatarUrl: string | null;
  wins: number;
  games: number;
  /** Full flat stats map (bot_* + online_*) — returned only for the caller. */
  stats: Record<string, number>;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  me: LeaderboardMe | null;
}

/** Online win/games totals from the flat stats map. */
export function onlineTotals(stats: Record<string, number>): { wins: number; games: number } {
  const wins = stats.online_w ?? 0;
  return { wins, games: wins + (stats.online_l ?? 0) + (stats.online_d ?? 0) };
}
```

- [ ] **Step 3: Run + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/server/accounts && npm test
# expect: all pass (139 baseline + new)
git add server/accounts/src/protocol.ts server/accounts/src/protocol.test.ts
git commit -m "$(cat <<'EOF'
Add leaderboard response types to the accounts protocol

LeaderboardEntry deliberately omits userId (clients highlight the
caller's row via me.rank instead), and the full stats map appears
only on me so bot counters are never exposed for other players.
EOF
)"
```

---

### Task 2: Accounts store — leaderboard key + query (TDD)

**Files:** modify `server/accounts/src/store.ts`, `server/accounts/src/store.test.ts`.

- [ ] **Step 1: Write failing tests** (against `InMemoryUserStore`; seed users with `putUser` carrying `stats`, then `setLeaderboardEntry`):
1. Three users with 5/3/9 wins → `getLeaderboard(100)` ordered 9, 5, 3; `wins`/`games` computed from each user's `stats` map (set e.g. `{online_w: 9, online_l: 1}` → games 10).
2. Tie at 5 wins between userIds `"aaa"` and `"zzz"` → `"zzz"` first (userId descending — inherent in the SK; pin the behavior).
3. `getLeaderboard(2)` with 3 entries → 2 rows.
4. Monotonic guard: `setLeaderboardEntry(u, 5)` then `setLeaderboardEntry(u, 4)` → user still ranked at 5 (stale write ignored, no throw); then `setLeaderboardEntry(u, 6)` → 6.
5. User with stats but no `setLeaderboardEntry` call → not on the board (zero-wins-invisible semantics).
6. `setLeaderboardEntry` for a missing user throws (mirrors the Dynamo `attribute_exists(PK)` condition).
7. `lbsk(42, "u1")` → `"W#00000042#u1"`; `lbsk(100_000_000, "u1")` clamps to `"W#99999999#u1"`.

- [ ] **Step 2: Implement.** In `store.ts`:

Interface additions on `UserStore` (after `addStat`):

```ts
  /** Refresh the LEADERBOARD GSI key after an online win. Monotonic: a stale
   *  (lower) wins value is silently ignored, so racing wins commute. In
   *  production this is called ONLY by the multiplayer Lambda's writer
   *  (record.ts duplicates the Dynamo impl below) — it lives here so the GSI
   *  key contract sits beside the reader and tests can seed board state. */
  setLeaderboardEntry(userId: string, wins: number): Promise<void>;
  /** Top players by online wins, descending (ties: userId descending). */
  getLeaderboard(limit: number): Promise<LeaderboardRow[]>;
```

Types + key helper (module level, exported):

```ts
export interface LeaderboardRow {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  wins: number;  // stats.online_w (projected map is always current)
  games: number; // online_w + online_l + online_d
}

const LB_PK = "LB";
const MAX_LB_WINS = 99_999_999;

/** LEADERBOARD GSI sort key: fixed-width so lexicographic order == numeric
 *  order. KEEP IN SYNC with server/multiplayer/src/record.ts. */
export function lbsk(wins: number, userId: string): string {
  const clamped = Math.max(0, Math.min(Math.floor(wins), MAX_LB_WINS));
  return `W#${String(clamped).padStart(8, "0")}#${userId}`;
}
```

`InMemoryUserStore` — add `private lb = new Map<string, number>();` and:

```ts
  async setLeaderboardEntry(userId: string, wins: number): Promise<void> {
    if (!this.users.has(userId)) throw new Error(`User not found: ${userId}`);
    const prev = this.lb.get(userId);
    // Mirrors the Dynamo condition (attribute_not_exists(LBSK) OR LBSK < :sk):
    // for a fixed userId, LBSK comparison reduces to the wins comparison.
    if (prev !== undefined && prev >= wins) return;
    this.lb.set(userId, wins);
  }

  async getLeaderboard(limit: number): Promise<LeaderboardRow[]> {
    const ordered = [...this.lb.entries()]
      .map(([userId, wins]) => ({ userId, sk: lbsk(wins, userId) }))
      .sort((a, b) => (a.sk < b.sk ? 1 : a.sk > b.sk ? -1 : 0))
      .slice(0, limit);
    return ordered.map(({ userId }) => {
      const u = this.users.get(userId);
      const stats = u?.stats ?? {};
      return {
        userId,
        displayName: u?.displayName ?? "Player",
        avatarUrl: u?.avatarUrl ?? null,
        wins: stats.online_w ?? 0,
        games: (stats.online_w ?? 0) + (stats.online_l ?? 0) + (stats.online_d ?? 0),
      };
    });
  }
```

`DynamoUserStore` (full code; `ConditionalCheckFailedException` is already imported):

```ts
  async setLeaderboardEntry(userId: string, wins: number): Promise<void> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `USER#${userId}`, SK: "META" },
          UpdateExpression: "SET LBPK = :lb, LBSK = :sk",
          ConditionExpression:
            "attribute_exists(PK) AND (attribute_not_exists(LBSK) OR LBSK < :sk)",
          ExpressionAttributeValues: { ":lb": LB_PK, ":sk": lbsk(wins, userId) },
        })
      );
    } catch (err) {
      // A concurrent win already wrote a higher LBSK — the count is intact
      // (ADD is atomic); only this stale key refresh loses, by design.
      if (err instanceof ConditionalCheckFailedException) return;
      throw err;
    }
  }

  async getLeaderboard(limit: number): Promise<LeaderboardRow[]> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "LEADERBOARD",
        KeyConditionExpression: "LBPK = :lb",
        ExpressionAttributeValues: { ":lb": LB_PK },
        ScanIndexForward: false, // highest LBSK (most wins) first
        Limit: limit,
      })
    );
    return (res.Items ?? []).map((it) => {
      const stats = (it.stats as Record<string, number>) ?? {};
      return {
        userId: String(it.PK ?? "").replace(/^USER#/, ""), // table keys are always projected
        displayName: (it.displayName as string) ?? "Player",
        avatarUrl: (it.avatarUrl as string | null) ?? null,
        wins: stats.online_w ?? 0,
        games: (stats.online_w ?? 0) + (stats.online_l ?? 0) + (stats.online_d ?? 0),
      };
    });
  }
```

Note on a subtle Dynamo edge: the `attribute_exists(PK)` half of the condition makes a missing-user write fail with `ConditionalCheckFailedException` too, which this impl then swallows — unlike InMemory's throw. Acceptable divergence (production writer always operates on existing users; the InMemory throw is the stricter test-time contract). Add this as a one-line comment.

- [ ] **Step 3: Run + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/server/accounts && npm test && npm run typecheck
git add server/accounts/src/store.ts server/accounts/src/store.test.ts
git commit -m "$(cat <<'EOF'
Add leaderboard GSI key contract and query to the user store

LBPK/LBSK live on the META item so the GSI's INCLUDE projection
(displayName, avatarUrl, stats) stays in sync with every stat update.
setLeaderboardEntry is monotonic (LBSK < :sk condition) so racing
wins commute; getLeaderboard reads order from LBSK and display values
from the projected stats map. The production writer is the
multiplayer Lambda, which duplicates this expression deliberately.
EOF
)"
```

---

### Task 3: Accounts handler — GET /v1/leaderboard (TDD)

**Files:** modify `server/accounts/src/handler.ts`, `server/accounts/src/handler.test.ts`.

- [ ] **Step 1: Write failing tests** (mint tokens with `issueSession` like the existing games-route tests; seed board via `store.putUser` + `store.setLeaderboardEntry`):
1. No Authorization → 200, `entries` ranked 1..N by wins descending, `me: null`, headers `cache-control: public, max-age=60` and `vary: Authorization`.
2. Entries shape: exactly `{rank, displayName, avatarUrl, wins, games}` — assert `userId` is NOT present and no `bot_*` key leaks anywhere in the serialized body for other users.
3. 101+ seeded users → 100 entries.
4. Valid token, caller in top 100 → `me.rank` equals their entry's rank, `me.stats` contains the full flat map (e.g. `bot_medium_w`), `cache-control: private, max-age=60`.
5. Valid token, caller NOT on the board (no `setLeaderboardEntry`, e.g. only bot stats) → `me.rank === null`, `me.wins`/`me.games` computed from their stats.
6. Garbage/expired token → 200, `me: null`, public cache header (never 401).
7. Empty board → 200, `entries: []`.

- [ ] **Step 2: Implement.** Change `json` to accept extra headers (all existing call sites unaffected):

```ts
function json(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {}
): HttpResponse {
  return { statusCode, headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) };
}
```

Add to the `handleRequest` switch (before `default`); imports: `onlineTotals` from `./protocol`, `LeaderboardMe` type from `./protocol` (`verifySession` is already imported):

```ts
    case "GET /v1/leaderboard": {
      // PUBLIC. A Bearer token is optional and only enriches the response;
      // an invalid/expired one degrades to the anonymous view, never 401.
      const rows = await deps.store.getLeaderboard(100);
      const entries = rows.map((row, i) => ({
        rank: i + 1,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        wins: row.wins,
        games: row.games,
      }));

      let me: LeaderboardMe | null = null;
      const token = bearerToken(event.headers);
      if (token) {
        try {
          const userId = await verifySession(deps.jwtSecret, token);
          const user = await deps.store.getUser(userId);
          if (user) {
            const idx = rows.findIndex((r) => r.userId === userId);
            const totals = onlineTotals(user.stats);
            me = {
              rank: idx >= 0 ? idx + 1 : null,
              displayName: user.displayName,
              avatarUrl: user.avatarUrl,
              wins: totals.wins,
              games: totals.games,
              stats: user.stats,
            };
          }
        } catch {
          // Anonymous view.
        }
      }

      return json(
        200,
        { entries, me },
        {
          "cache-control": me ? "private, max-age=60" : "public, max-age=60",
          vary: "Authorization",
        }
      );
    }
```

- [ ] **Step 3: Run + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/server/accounts
npm test && npm run typecheck && npm run build
git add server/accounts/src/handler.ts server/accounts/src/handler.test.ts
git commit -m "$(cat <<'EOF'
Add public GET /v1/leaderboard to the accounts Lambda

Top 100 by online wins from the LEADERBOARD GSI, with no userIds in
the public payload. An optional Bearer token adds a me entry (rank
when inside the top 100, null otherwise) carrying the caller's full
stats map for the Your-stats section; invalid tokens degrade to the
anonymous view rather than 401. Cache-Control is public max-age=60
for anonymous responses, private for personalized ones, with
Vary: Authorization.
EOF
)"
```

---

### Task 4: Accounts CloudFormation — GSI + route + index IAM

**Files:** modify `server/aws/accounts.yaml`.

- [ ] **Step 1: Table — attribute definitions + GSI.** In `UsersTable.Properties`:

```yaml
      AttributeDefinitions:
        - AttributeName: PK
          AttributeType: S
        - AttributeName: SK
          AttributeType: S
        - AttributeName: LBPK
          AttributeType: S
        - AttributeName: LBSK
          AttributeType: S
```

and after `KeySchema`:

```yaml
      GlobalSecondaryIndexes:
        - IndexName: LEADERBOARD
          KeySchema:
            - AttributeName: LBPK
              KeyType: HASH
            - AttributeName: LBSK
              KeyType: RANGE
          Projection:
            ProjectionType: INCLUDE
            NonKeyAttributes:
              - displayName
              - avatarUrl
              - stats
```

(PAY_PER_REQUEST ⇒ no `ProvisionedThroughput` on the GSI. This is an in-place table UPDATE: the table stays available, the index backfills, and CloudFormation allows only one GSI addition per update — this is the only one. Items appear in the index only once `LBPK`/`LBSK` are written, i.e. lazily on each user's next online win.)

- [ ] **Step 2: IAM — index ARN.** Querying a GSI authorizes against the index ARN, not the table ARN. The `dynamodb` policy statement's `Resource` becomes a list:

```yaml
                Resource:
                  - !GetAtt UsersTable.Arn
                  - !Sub "${UsersTable.Arn}/index/*"
```

- [ ] **Step 3: Route.** Add beside the existing routes and extend the Stage `DependsOn` with `LeaderboardRoute`:

```yaml
  LeaderboardRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref HttpApi
      RouteKey: "GET /v1/leaderboard"
      Target: !Sub "integrations/${Integration}"
```

(CORS `CorsConfiguration` already allows GET + the site origins; no change.)

- [ ] **Step 4: Validate + commit**

```bash
AWS_PROFILE=sahasralabs aws cloudformation validate-template \
  --template-body file:///Users/sahasra/Personal/work/chess-app/server/aws/accounts.yaml \
  --region us-east-1
# expect: parameter listing (JwtSecret NoEcho). If creds unavailable, defer to Task 9 and note it.
git add server/aws/accounts.yaml
git commit -m "$(cat <<'EOF'
Add LEADERBOARD GSI and leaderboard route to the accounts stack

Constant-partition GSI (LBPK="LB", LBSK="W#<wins zero-padded 8>#<userId>")
on the users table with an INCLUDE projection of displayName,
avatarUrl, and stats. Query on a GSI authorizes against the index
ARN, so the Lambda policy resource list gains table/<name>/index/*.
Single GSI addition per CFN update; the table updates in place.
EOF
)"
```

---

### Task 5: Multiplayer record — LBSK refresh on online wins (TDD)

**Files:** modify `server/multiplayer/src/record.ts`, `server/multiplayer/src/record.test.ts`, `server/multiplayer/src/handler.test.ts` (FakeWriter signature only).

- [ ] **Step 1: Write failing tests** (`record.test.ts`). Update `FakeWriter`: `addStat` keeps an internal `Map<string, number>` keyed `"<userId>:<key>"`, increments, records the call, and **returns the new count**; add `lbCalls: { userId: string; wins: number }[]` and `async setLeaderboardEntry(userId, wins) { this.lbCalls.push({ userId, wins }); }` (also throw when `shouldThrowForUserId` matches, for isolation tests). New/updated cases:
1. Checkmate, white wins, both signed in → exactly ONE `setLeaderboardEntry` call: the winner's userId with `wins === 1` (the post-increment count); the loser gets `online_l` and NO leaderboard call.
2. Second win for the same user (call `recordFinishedGame` twice with fresh rooms) → second `setLeaderboardEntry` carries `wins === 2` (proves the count flows from `addStat`'s return).
3. Stalemate → both get `online_d`, zero `setLeaderboardEntry` calls (draws never touch LBSK).
4. Winner is a guest (no userId), loser signed in → no leaderboard calls.
5. `setLeaderboardEntry` throwing for the winner → the winner's `putGame` + `addStat` already happened, and the **other seat is still processed** (existing per-seat isolation covers it; assert the loser's calls landed).

- [ ] **Step 2: Implement `record.ts`.**

Interface (the `wins` doc comment is the contract `record.ts` shares with `server/accounts/src/store.ts`):

```ts
export interface UserGamesWriter {
  putGame(userId: string, game: OnlineGameRecord): Promise<void>;
  /** Increment a flat stats counter by 1 and return the post-increment value. */
  addStat(userId: string, key: string): Promise<number>;
  /** Refresh the LEADERBOARD GSI key for a new online-win count. Monotonic:
   *  a stale (lower) value must be a silent no-op. */
  setLeaderboardEntry(userId: string, wins: number): Promise<void>;
}
```

`recordFinishedGame` — replace the two stat lines inside the per-seat `try`:

```ts
      const key = winner == null ? "online_d" : winner === color ? "online_w" : "online_l";
      const count = await writer.addStat(seat.userId, key);
      if (key === "online_w") {
        // Only wins can reorder the board. Losses/draws stay fresh via the
        // GSI projection of the stats map (same META item addStat mutates).
        await writer.setLeaderboardEntry(seat.userId, count);
      }
```

`DynamoUserGamesWriter` — `addStat` gains `ReturnValues` (note the exact `UPDATED_NEW` shape for a nested path), and `setLeaderboardEntry` is a deliberate copy of `server/accounts/src/store.ts` (same justification as the existing `putGame`/`addStat` duplication — keep in sync):

```ts
  async addStat(userId: string, key: string): Promise<number> {
    const res = await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `USER#${userId}`, SK: "META" },
        UpdateExpression: "ADD stats.#k :one",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: { "#k": key },
        ExpressionAttributeValues: { ":one": 1 },
        ReturnValues: "UPDATED_NEW",
      })
    );
    // UPDATED_NEW on a nested path returns only the modified portion:
    // { stats: { [key]: <new count> } }.
    const updated = (res.Attributes?.stats as Record<string, number> | undefined)?.[key];
    if (typeof updated !== "number") {
      throw new Error(`addStat: missing updated count for ${key}`);
    }
    return updated;
  }

  async setLeaderboardEntry(userId: string, wins: number): Promise<void> {
    // Deliberate copy of server/accounts/src/store.ts setLeaderboardEntry —
    // keep the key format and condition in sync.
    const clamped = Math.max(0, Math.min(Math.floor(wins), 99_999_999));
    const sk = `W#${String(clamped).padStart(8, "0")}#${userId}`;
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `USER#${userId}`, SK: "META" },
          UpdateExpression: "SET LBPK = :lb, LBSK = :sk",
          ConditionExpression:
            "attribute_exists(PK) AND (attribute_not_exists(LBSK) OR LBSK < :sk)",
          ExpressionAttributeValues: { ":lb": "LB", ":sk": sk },
        })
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return; // newer count already landed
      throw err;
    }
  }
```

Imports: add `ConditionalCheckFailedException` to the `@aws-sdk/client-dynamodb` import.

- [ ] **Step 3: Fix `handler.test.ts`'s FakeWriter** the same way (return the incremented count; add a no-op `setLeaderboardEntry`) — no behavioral test changes there; the recording hook is unchanged.

- [ ] **Step 4: Run + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/server/multiplayer && npm test && npm run typecheck && npm run build
git add server/multiplayer/src/record.ts server/multiplayer/src/record.test.ts \
        server/multiplayer/src/handler.test.ts
git commit -m "$(cat <<'EOF'
Refresh the leaderboard GSI key when an online win is recorded

DynamoDB cannot SET LBSK from a post-ADD value in one expression, so
addStat returns the new count via ReturnValues=UPDATED_NEW and a
second UpdateItem sets LBPK/LBSK computed client-side, guarded by
LBSK < :sk so racing wins commute (the higher key always survives;
ConditionalCheckFailed is swallowed). Losses and draws never touch
LBSK - games counts stay fresh through the GSI projection of the
stats map on the same META item.
EOF
)"
```

(No IAM or template change for the multiplayer stack: `UpdateItem` on the users table is already granted, and GSI maintenance is implicit in table writes.)

---

### Task 6: Web — leaderboard API client + display helpers (TDD)

**Files:** create `web/src/auth/leaderboardApi.ts`, `web/src/auth/leaderboardApi.test.ts`, `web/src/ui/leaderboardView.test.ts` (helpers only; the view itself lands in Task 7 — put the helpers in `leaderboardApi.ts` so the test file matches the module).

Decision refinement: keep ALL pure logic (`winRateText`, `statLines`) in `web/src/auth/leaderboardApi.ts` next to the types, tested in `leaderboardApi.test.ts`; `leaderboardView.ts` (Task 7) stays DOM-only and untested, matching the `pastGamesView` policy. (Drop the separate `leaderboardView.test.ts` from the file table — one test file.)

- [ ] **Step 1: Write failing tests** (`leaderboardApi.test.ts`, fake fetch like `gamesApi.test.ts`):
1. `fetchLeaderboard(base)` → GET `<base>/v1/leaderboard`, NO Authorization header.
2. `fetchLeaderboard(base, "tok")` → `Authorization: Bearer tok`.
3. Non-2xx → throws `AuthApiError` with status (via `checkResponse`).
4. Parses `{entries, me}` including `me: null`.
5. `winRateText(3, 4)` → `"75%"`; `(0, 0)` → `"—"`; `(1, 3)` → `"33%"` (rounded).
6. `statLines({online_w: 2, online_l: 1, bot_medium_w: 3, bot_medium_d: 1})` → `[{label: "Online", w: 2, l: 1, d: 0}, {label: "Bot · medium", w: 3, l: 0, d: 1}]` — online first, then easy/medium/hard order, zero-game rows omitted; `statLines({})` → `[]`.

- [ ] **Step 2: Implement `leaderboardApi.ts`** — full file:

```ts
import { checkResponse } from "./api";

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  avatarUrl: string | null;
  wins: number;
  games: number;
}

export interface LeaderboardMe {
  rank: number | null; // null ⇒ outside the top 100 (render as "—")
  displayName: string;
  avatarUrl: string | null;
  wins: number;
  games: number;
  stats: Record<string, number>;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  me: LeaderboardMe | null;
}

/** Public endpoint; the token only adds the caller's own `me` entry. */
export async function fetchLeaderboard(
  baseUrl: string,
  token?: string | null,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<LeaderboardResponse> {
  const res = await fetchImpl(`${baseUrl}/v1/leaderboard`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });
  await checkResponse(res);
  return res.json() as Promise<LeaderboardResponse>;
}

export function winRateText(wins: number, games: number): string {
  if (games <= 0) return "—";
  return `${Math.round((wins / games) * 100)}%`;
}

export interface StatLine {
  label: string;
  w: number;
  l: number;
  d: number;
}

/** "Your stats" rows from the flat map: Online first, then bot per
 *  difficulty. Rows with zero games are omitted. */
export function statLines(stats: Record<string, number>): StatLine[] {
  const lines: StatLine[] = [];
  const online: StatLine = {
    label: "Online",
    w: stats.online_w ?? 0,
    l: stats.online_l ?? 0,
    d: stats.online_d ?? 0,
  };
  if (online.w + online.l + online.d > 0) lines.push(online);
  for (const diff of ["easy", "medium", "hard"] as const) {
    const line: StatLine = {
      label: `Bot · ${diff}`,
      w: stats[`bot_${diff}_w`] ?? 0,
      l: stats[`bot_${diff}_l`] ?? 0,
      d: stats[`bot_${diff}_d`] ?? 0,
    };
    if (line.w + line.l + line.d > 0) lines.push(line);
  }
  return lines;
}
```

- [ ] **Step 3: Run + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/web && npm test && npx tsc --noEmit
git add web/src/auth/leaderboardApi.ts web/src/auth/leaderboardApi.test.ts
git commit -m "$(cat <<'EOF'
Add leaderboard API client and display helpers on web

fetchLeaderboard sends the Bearer token only when present (the
endpoint is public); winRateText and statLines keep the screen's
logic pure and tested while the view stays DOM-only.
EOF
)"
```

---

### Task 7: Web — Leaderboard screen + navigation

**Files:** create `web/src/ui/leaderboardView.ts`; modify `web/src/ui/home.ts`, `web/src/main.ts`, `web/src/styles.css`. (DOM-heavy — no unit tests, same policy as `pastGamesView.ts`; the logic lives in Task 6.)

- [ ] **Step 1: `leaderboardView.ts`.** Mirror `pastGamesView.ts` exactly in structure (AbortController, `destroyed` flag, `el()` helper, `resolveApiUrl()` try/catch, header with `← Back` + `h2 "Leaderboard"`, destroy fn that aborts + clears root). Export:

```ts
export function renderLeaderboard(root: HTMLElement, onBack: () => void): () => void
```

Behavior:
- `const token = isAuthConfigured ? getSessionToken() : null;` then `fetchLeaderboard(baseUrl, token, fetch, abort.signal)` — note the token is OPTIONAL here, unlike past games: guests see the board too. When `baseUrl` is undefined (accounts unconfigured), show only "Leaderboard isn't available." note.
- While loading: `el("p", "leaderboard-note", "Loading…")`.
- **"Your stats" section** (`me != null` and `statLines(me.stats).length > 0`): `h3 "Your stats"`, one row per `StatLine`: label + `${w}W ${l}L ${d}D` + `winRateText(w, w+l+d)`.
- **Table** (`div.leaderboard-table`): header row `# / Player / W / G / Win %`; one `div.leaderboard-row` per entry — rank, avatar (`img.leaderboard-avatar` only when `avatarUrl`, with `referrerpolicy="no-referrer"` matching the auth widget's avatar handling), displayName, wins, games, `winRateText`. Add class `me` to the row whose `rank === me?.rank` (highlight).
- **Pinned me row** (`me && me.rank === null && me.games > 0`): after the table, a separator note "Your ranking" + a `.leaderboard-row.me` with rank cell "—".
- Empty board → "No ranked players yet — win an online game!".
- Fetch error (non-abort) → "Couldn't load the leaderboard — try again later.".
- No auto-refresh; navigating away and back re-fetches (60s server cache absorbs it).

- [ ] **Step 2: Home + routing.** `home.ts`: `renderHome` gains a fifth param `onLeaderboard: () => void = () => {}`; append a plain `Leaderboard` button right after the `Past Games` button:

```ts
    const leaderboardBtn = el("button", "", "Leaderboard");
    leaderboardBtn.onclick = () => onLeaderboard();
    actions.appendChild(leaderboardBtn);
```

`main.ts` — mirror `showPastGames` (lazy import, teardown, error handling) and pass it into `renderHome` as the new last argument:

```ts
  function showLeaderboard(): void {
    void import("./ui/leaderboardView")
      .then(({ renderLeaderboard }) => {
        teardownGame?.();
        teardownGame = renderLeaderboard(app, showHome);
      })
      .catch(/* mirror startGame's error handling */);
  }
```

- [ ] **Step 3: `styles.css`** — `.leaderboard` (container, `.home-actions` width), `.leaderboard-table` (grid: `auto 1fr auto auto auto`, gap), `.leaderboard-row` (surface background; `.me` accent border/background), `.leaderboard-avatar` (20px round), `.leaderboard-note` (muted), `.your-stats` rows. Follow existing custom-property usage.

- [ ] **Step 4: Verify + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/web && npm test && npx tsc --noEmit && npm run build
# npm run dev → Home shows Leaderboard → opens; guest sees table (or empty note);
# signed-in sees Your stats block; Back returns home.
git add web/src/ui/leaderboardView.ts web/src/ui/home.ts web/src/main.ts web/src/styles.css
git commit -m "$(cat <<'EOF'
Add Leaderboard screen on web

Public top-100 table (rank, name, wins, games, win rate) reachable
from Home, with the signed-in user's row highlighted inside the top
100 or pinned below it with rank shown as a dash. A Your-stats block
at the top shows the caller's own online and per-difficulty bot
records - one screen, no new nav surface.
EOF
)"
```

---

### Task 8: iOS — API + LeaderboardView + Home link + decode tests

**Files:** modify `ChessBorder/ChessBorder/Auth/AccountsAPI.swift`, `ChessBorder/ChessBorder/Views/HomeView.swift`; create `ChessBorder/ChessBorder/Views/LeaderboardView.swift`, `ChessBorder/ChessBorderTests/LeaderboardTests.swift`; regenerate the Xcode project.

- [ ] **Step 1: `AccountsAPI.swift` additions** (same request style as `listGames`):

```swift
struct LeaderboardEntry: Codable, Identifiable {
    let rank: Int
    let displayName: String
    let avatarUrl: String?
    let wins: Int
    let games: Int
    var id: Int { rank }
}

struct LeaderboardMe: Codable {
    let rank: Int?          // nil ⇒ outside the top 100 (render "—")
    let displayName: String
    let avatarUrl: String?
    let wins: Int
    let games: Int
    let stats: [String: Int]
}

struct LeaderboardResponse: Codable {
    let entries: [LeaderboardEntry]
    let me: LeaderboardMe?
}

    /// GET /v1/leaderboard — public; Bearer optional (adds `me`).
    func leaderboard(token: String?) async throws -> LeaderboardResponse {
        var request = URLRequest(url: baseURL.appending(path: "v1/leaderboard"))
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AccountsAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw AccountsAPIError.http(http.statusCode) }
        return try JSONDecoder().decode(LeaderboardResponse.self, from: data)
    }
```

Decode note: server JSON `null`s (`avatarUrl`, `rank`, `me`) map to the optionals automatically; `stats` values are integers (DynamoDB numbers) so `[String: Int]` decodes.

- [ ] **Step 2: `LeaderboardView.swift`.** Mirror `PastGamesView` chrome exactly (`ZStack` + `BoardTheme.background`, `.navigationTitle("Leaderboard")`, `.chessAppNavigationChromeHidden()`, `sectionHeader` style, `GameSurfaceCard` rows). Structure:
- `@State private var entries: [LeaderboardEntry] = []`, `@State private var me: LeaderboardMe?`, `@State private var loadError = false`, `@State private var loaded = false`; `@StateObject private var auth = AuthStore.shared`.
- `.task`: guard `AccountsConfig.isConfigured, let url = AccountsConfig.serverURL` else mark loaded; call `AccountsAPI(baseURL: url).leaderboard(token: auth.sessionToken)` (token may be nil — guests still load); set state; failures set `loadError`.
- **"Your stats"** section when `me != nil` and it has any nonzero counters: rows mirroring web `statLines` (Online, Bot · easy/medium/hard; omit zero-game rows; show `2W 1L 0D · 67%`). Implement `statLines(_ stats: [String: Int]) -> [(label: String, w: Int, l: Int, d: Int)]` as a `static` helper on `LeaderboardView` (or file-private func) so the fixture test can exercise it.
- **Table** section "Top players": one row per entry — rank (monospacedDigit), `AsyncImage` for `avatarUrl` (24pt circle, gray placeholder), displayName, spacer, `\(wins)W · \(games)G · <rate>%`. Highlight when `entry.rank == me?.rank` (accent-tinted `GameSurfaceCard` border, matching the app's accent usage).
- **Pinned me row** when `me != nil && me!.rank == nil && me!.games > 0`: section "Your ranking", rank cell "—".
- Empty entries + loaded → "No ranked players yet — win an online game!" empty state (clone `PastGamesView.emptyState` with `trophy` SF symbol). `loadError` → muted "Couldn't load the leaderboard" caption.
- Win-rate helper mirroring web `winRateText` (rounded percent, "—" at 0 games).

- [ ] **Step 3: `HomeView.swift`** — below the existing Past Games `NavigationLink`, same styling:

```swift
                        NavigationLink {
                            LeaderboardView()
                        } label: {
                            Text("Leaderboard")
                                .font(.subheadline)
                                .foregroundStyle(.white.opacity(0.7))
                                .frame(maxWidth: .infinity)
                                .padding(.top, 4)
                        }
                        .buttonStyle(.plain)
```

- [ ] **Step 4: `LeaderboardTests.swift`** (Mac-runnable, no network):
1. Decode a full fixture: 2 entries (one `avatarUrl: null`) + `me` with `rank: null` and a stats map containing `bot_medium_w`/`online_w` → all fields land.
2. Decode `{"entries": [], "me": null}` → empty/nil.
3. `me` with `rank: 5` → `rank == 5`.
4. Stat-lines helper: Online first, bot difficulty order, zero-game rows omitted (mirror the web tests' fixture).

- [ ] **Step 5: Regenerate + KNOWN XCODEGEN GOTCHAS:**

```bash
cd /Users/sahasra/Personal/work/chess-app/ChessBorder
xcodegen generate
git diff --stat
```

After EVERY `xcodegen generate`:
1. **Restore the Mac scheme's BuildableName** if rewritten: `git checkout -- ChessBorder.xcodeproj/xcshareddata/xcschemes/ChessBorderMac.xcscheme` (tracked value is `Border Chess.app`).
2. **Revert any Info.plist version-key drift** (`CFBundleShortVersionString`/`CFBundleVersion`) in `ChessBorder/Info.plist` / `Info-mac.plist` — `project.yml` is the source of truth.

- [ ] **Step 6: Build + test + commit**

```bash
xcodebuild -project ChessBorder.xcodeproj -scheme ChessBorder \
  -destination 'generic/platform=iOS Simulator' build | tail -3   # BUILD SUCCEEDED
xcodebuild -project ChessBorder.xcodeproj -scheme ChessBorderMac test | tail -3
# expect: ONLY the pre-existing OnlineTests border-move failure; LeaderboardTests pass
git add ChessBorder/ChessBorder/Auth/AccountsAPI.swift \
        ChessBorder/ChessBorder/Views/LeaderboardView.swift \
        ChessBorder/ChessBorder/Views/HomeView.swift \
        ChessBorder/ChessBorderTests/LeaderboardTests.swift \
        ChessBorder/ChessBorder.xcodeproj
git commit -m "$(cat <<'EOF'
Add Leaderboard screen on iOS

Public top-100 list mirroring the web screen, reachable from Home
beside Past Games. Signed-in users get a Your-stats section (online
plus per-difficulty bot records), a highlighted own row inside the
top 100, or a pinned rankless row below it.
EOF
)"
```

---

### Task 9: Validation matrix + verify-site smoke check + deploy notes

**Files:** modify `scripts/verify-site.sh`.

- [ ] **Step 1: Extend the accounts block** in `scripts/verify-site.sh` — after the existing `/v1/games` 401 check (inside the `ACCOUNTS_API_URL` block), add:

```bash
  lbcode="$("$CURL" -s -o /dev/null -w "%{http_code}" "${ACCOUNTS_API_URL%/}/v1/leaderboard" || echo "000")"
  lbbody="$("$CURL" -s "${ACCOUNTS_API_URL%/}/v1/leaderboard" || echo "")"
  if [[ "$lbcode" == "200" && "$lbbody" == *'"entries"'* ]]; then
    echo "OK   leaderboard api (public /v1/leaderboard -> 200 JSON)"
  else
    echo "FAIL leaderboard api (expected 200 with entries, got $lbcode)"; FAIL=1
  fi
```

(The script's failure variable is `FAIL`.)

- [ ] **Step 2: Full validation matrix** — run every row; all must hold:

| Check | Command | Expect |
|---|---|---|
| Accounts tests | `(cd server/accounts && npm test)` | all pass (139 baseline + new) |
| Accounts types/build | `(cd server/accounts && npm run typecheck && npm run build)` | clean, `dist/index.js` |
| Multiplayer tests | `(cd server/multiplayer && npm test)` | all pass (44 baseline + new) |
| Multiplayer types/build | `(cd server/multiplayer && npm run typecheck && npm run build)` | clean |
| Web tests | `(cd web && npm test)` | all pass (128 baseline + new) |
| Web types | `(cd web && npx tsc --noEmit)` | clean |
| Web prod build | `(cd web && npm run build)` | succeeds |
| iOS sim build | `(cd ChessBorder && xcodebuild -project ChessBorder.xcodeproj -scheme ChessBorder -destination 'generic/platform=iOS Simulator' build \| tail -3)` | BUILD SUCCEEDED |
| Mac tests | `(cd ChessBorder && xcodebuild -project ChessBorder.xcodeproj -scheme ChessBorderMac test \| tail -3)` | exactly ONE failure: pre-existing OnlineTests border-move |
| Accounts CFN | `AWS_PROFILE=sahasralabs aws cloudformation validate-template --template-body file://server/aws/accounts.yaml --region us-east-1` | valid |
| verify-site parses | `bash -n scripts/verify-site.sh` | silent |

Manual web smoke (dev server, pointed at a deployed or local-stub API): guest opens Leaderboard → table or empty note, no auth prompt; signed-in user sees Your stats; win an online game between two signed-in seats → winner appears/moves up on next load.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-site.sh
git commit -m "$(cat <<'EOF'
Smoke-check the leaderboard API in verify-site

Public GET /v1/leaderboard must return 200 with an entries field,
alongside the existing /v1/me and /v1/games 401 checks.
EOF
)"
```

- [ ] **Step 4: Deploy notes (do NOT deploy in this plan).** Order matters:
1. `AWS_PROFILE=sahasralabs ./server/aws/deploy-accounts.sh` — **GSI first**: the CFN update adds the `LEADERBOARD` index (in-place; table stays available; backfill takes minutes — wait for the stack update to complete, which implies index ACTIVE), plus the route, index IAM, and new Lambda code. One GSI change per CFN update — this is the only one.
2. `AWS_PROFILE=sahasralabs ./server/aws/deploy-multiplayer.sh` — the LBSK-writing Lambda. (Safe in either order — LBPK/LBSK written pre-index would be picked up by the backfill — but accounts-first means `GET /v1/leaderboard` exists before anything writes to it.)
3. Web: rebuild + `./web/scripts/sync-s3-static.sh` (no new env vars — leaderboard rides on `VITE_ACCOUNTS_API_URL`).
4. `ACCOUNTS_API_URL=... ./scripts/verify-site.sh` — leaderboard 200 check green.
5. iOS ships with the next app version bump (`project.yml`).
6. Existing users (~0 real ones) appear on the board lazily at their next online win; no backfill is run.

---

## Self-Review

- [x] **Spec coverage (Phase 4):** stats-only ranking by online wins ✓ (only `record.ts`'s server-authoritative `online_w` feeds `LBSK`; client-reported bot stats can't rank); top 100 ✓; ~60s cacheable ✓ (`Cache-Control` max-age=60, public/private split + `Vary: Authorization` so personalized bodies never hit shared caches); own row pinned when outside top 100 ✓ (rank consciously narrowed to "—" instead of an exact >100 number — counting GSI items ahead of the caller is the documented upgrade path); bot stats on own profile only ✓ (`stats` map appears solely on `me`; projected `bot_*` counters are stripped from public entries). Spec said "transactionally updates stats + leaderboard item"; this plan consciously uses two plain UpdateItems on the SAME item instead — a transaction cannot express SET-from-post-ADD either, the counter is never wrong (ADD is atomic), and the worst failure mode (crash between the two updates) leaves a rank one win stale until the user's next win. Flagged trade, accepted at this scale.
- [x] **Atomicity/race mechanics verified:** `UPDATED_NEW` on a nested path returns `{stats: {key: n}}`; fixed-width zero-padding + constant userId suffix make the `LBSK < :sk` condition a numeric monotonic guard; `ConditionalCheckFailedException` swallowed only there. Self-play, guest seats, draw/loss paths all hold (wins-only hook inside the existing per-seat isolation).
- [x] **Projection semantics verified:** INCLUDE-projected non-key attributes (`displayName`, `avatarUrl`, `stats`) are maintained by DynamoDB on every base-item update — so renames and loss/draw counters stay fresh with zero leaderboard code in the accounts write paths; LBSK changes only on wins. Display-wins-vs-order race flagged (momentary, self-healing).
- [x] **Infra gaps closed:** GSI Query needs the index ARN (policy `Resource` becomes a list); `LBPK`/`LBSK` added to `AttributeDefinitions` in the same update; PAY_PER_REQUEST ⇒ no GSI throughput block; one-GSI-per-update honored; multiplayer stack needs nothing new (UpdateItem already granted, GSI writes implicit).
- [x] **Type consistency:** `LeaderboardEntry`/`LeaderboardMe`/`LeaderboardResponse` field-identical across accounts protocol, web `leaderboardApi.ts`, and iOS `AccountsAPI.swift` (optionals where the server emits null); `lbsk` format duplicated in exactly two places (accounts store = canonical, multiplayer writer = flagged copy), matching the established Phase 3 duplication pattern; route key in CFN matches the handler switch and both clients' paths.
- [x] **Interface ripple handled:** `UserGamesWriter.addStat` signature change touches both FakeWriters (`record.test.ts`, `handler.test.ts`) — called out explicitly so the build never sits broken between tasks. Accounts `UserStore.addStat` deliberately stays `Promise<void>` (its caller never needs the count).
- [x] **Degradation:** leaderboard fetch failure shows a note (web) / caption (iOS), never blocks play; invalid/expired session degrades to the anonymous board (no 401, no sign-in nag); accounts unconfigured ⇒ screen says so; guests get the full public board.
- [x] **Pattern fidelity:** TDD where logic exists (key format, ordering, monotonic guard, handler `me`/cache logic, win-only hook, API clients, stat-line/win-rate helpers); DOM/SwiftUI chrome untested per existing policy; screens mirror `pastGamesView.ts`/`PastGamesView.swift` structurally; xcodegen gotchas restated at the step they bite; commits are HEREDOC, imperative, no co-author trailer; baselines 139/44/128/59-with-1-known-failure pinned at start and end.
