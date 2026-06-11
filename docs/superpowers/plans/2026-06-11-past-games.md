# Past Games (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every completed game lands in a rolling local history (last 25, guests included) on web + iOS. Signed-in users additionally get cloud history: bot/local games are uploaded by the client to the accounts API (`POST /v1/games`, with an offline retry queue), and online games are recorded **server-side** by the multiplayer Lambda, attributed via an optional session JWT presented at WebSocket connect. A Past Games screen on both platforms lists games and opens a read-only **replay viewer** built on the existing game view's history stepping (Phase 5's post-game review reuses it). Stats counters (`bot_<difficulty>_<w|l|d>`, `online_<w|l|d>`) are maintained now so Phase 4's leaderboard only reads.

**Architecture:** Phase 3 EXTENDS the Phase 2 accounts Lambda and `chess-border-users` table — no new stack. New items `USER#<userId>` / `GAME#<endedAtISO>#<gameId>` sit beside the existing `META` profile item; `GET /v1/games` is a newest-first Query (PK = `USER#<sub>`, SK `begins_with GAME#`, `ScanIndexForward: false`, page 20). The multiplayer Lambda gets the same JWT secret (same SSM param `/chess-border/accounts/jwt-secret` passed via its CFN stack), verifies an optional `session` query param at `$connect`, stores the userId on the seat, and writes `GAME#` items directly to the users table at game end.

**Tech Stack:** TypeScript + `node:test` via `tsx` (server + web), vanilla TS controllers (web), SwiftUI + ViewModels (iOS), CloudFormation + bash deploy scripts (infra), `xcodegen` for project regeneration.

**Branch:** `past-games` off `main`. Spec: `docs/superpowers/specs/2026-06-11-production-features-design.md` (Phase 3).

**Conventions:** imperative commit subjects, no `feat:` prefixes, HEREDOC commit messages, NO Claude co-author trailer. Minimize diff scope; match existing naming/patterns per package.

**Known baselines (verify before starting, re-verify at the end):**
- `server/accounts`: 87 tests pass
- `server/multiplayer`: 16 tests pass
- `web`: 69 tests pass
- Mac suite (`xcodebuild -scheme ChessBorderMac test`): exactly ONE pre-existing failure (OnlineTests border-move) — do not "fix" it, do not add to it
- iOS simulator build succeeds (`-scheme ChessBorder -destination 'generic/platform=iOS Simulator'`)

---

## Settled decisions encoded in this plan (do not relitigate)

- **Local history is first-class:** rolling last-25 completed games on both platforms, guests included. Web: new `web/src/game/gameHistory.ts`, localStorage key `chessborder.gameHistory` (versioned JSON `{version: 1, games: [...]}`, newest first). iOS: `Game/GameHistoryStore.swift` mirroring it on UserDefaults, same key.
- **Exactly-once append per game:** an in-session `historyRecorded` flag (reset on New Game) covers the live path; a content-based dedupe in the store (skip when an existing entry has identical `mode` + `moves` + `resultType`) covers reloading a finished saved game. Known accepted false negative: two *separate* games with the byte-identical move sequence and result dedupe to one entry — vanishingly rare in real play, flagged here deliberately.
- **`endedAt` is set when the record is built**, so a finished game restored in a later session would get a fresh `endedAt` — that's why dedupe ignores `endedAt`.
- **Cloud upload is client-driven for bot/local games only.** `POST /v1/games` **rejects `mode: "online"`** (400): online games are written exclusively by the multiplayer Lambda (authoritative; results can't be spoofed), and accepting them client-side would double-record. Bot-game stats are therefore client-reported (spoofable) — acceptable because they only ever appear on the user's own profile; the Phase 4 leaderboard ranks **online** wins, which are server-authoritative.
- **One shared pending-uploads mechanism per platform:** web `web/src/game/gameUploads.ts` (localStorage key `chessborder.pendingGameUploads`, flushed on boot from `main.ts`); iOS `Game/GameUploadQueue.swift` (UserDefaults, flushed on launch). Upload = enqueue + flush, so the success and retry paths are the same code. Queue capped at 10 (oldest dropped). Guests are never queued — if you're signed out when the game ends, the game stays local-only (no retroactive upload on later sign-in; flagged simplification).
- **`gameId` is server-assigned** on `POST /v1/games` (client-sent `gameId` is ignored). Local records keep their client-generated UUID; the cloud copy has the server's. No cross-referencing needed this phase.
- **`GET /v1/games/{gameId}`** is implemented as a Query over the user's `GAME#` items with a `FilterExpression` on `gameId` (no GSI). Bounded by per-user game counts (low hundreds at most for a long while); revisit with a GSI if it ever matters. The list response already includes full move lists (a page of 20 games ≈ 10 KB), so clients rarely need this route — it exists for deep links and Phase 5.
- **Stats counters** live in the existing `stats` map on `USER#<id>/META` as **flat** keys: `bot_easy_w`, `bot_easy_l`, `bot_easy_d`, … `bot_hard_d`, `online_w`, `online_l`, `online_d` (flat keys keep DynamoDB `ADD stats.#k :one` a single nested path — no map-of-maps initialization dance). `UserRecord.stats` changes type from `Record<string, never>` to `Record<string, number>`. All Phase-2 users were created with `stats: {}` so the nested ADD path exists; stat updates are **best-effort** (wrapped in try/catch — the `GAME#` item is the source of truth and Phase 4 can backfill).
- **`localTwoPlayer` games are stored in history but never counted in stats** (two humans, one device — no attribution).
- **Multiplayer session verify is a ~25-line copy** of `server/accounts/src/session.ts`'s `verifySession` into `server/multiplayer/src/session.ts` (plus a `jose` dep). Duplicating 30 lines beats a shared-package refactor across two independently-deployed Lambdas; extract later if a third consumer appears. The same reasoning covers the small Dynamo games-writer in `record.ts` duplicating the accounts store's item shape.
- **Session JWT travels as a `?session=` query param on the WebSocket URL** (browsers cannot set headers on WebSocket connects). `$connect` receives `event.queryStringParameters` — the current `WsEvent` type must grow that field. Invalid/expired/missing session ⇒ the connection proceeds as a guest seat (today's behavior); the connection is **never** rejected. Note: the JWT would appear in API GW access logs — none are enabled on this API today; acceptable, flagged.
- **Online game-end recording happens in the handler, not the room reducer** (the reducer stays pure). Trigger: a `move` message whose room transitions `status !== "finished"` → `"finished"`. Rematch resets `moves`/`result`, so each rematch game records again at its own transition; reconnecting into an already-finished room never re-records (no transition). Spectators have no seat ⇒ never recorded. Recording runs **after** the move broadcast and is wrapped in try/catch — it must never fail or delay the move. Note: `resignation` cannot currently occur online (no resign message in the multiplayer protocol) — the recorder still handles it for forward-compat.
- **Both seats same signed-in user (self-play across devices):** both writes share PK and SK ⇒ one item survives, and stats get +1 w and +1 l. Trivial accepted edge.
- **Replay viewer reuses the existing game view** — web: new entry point `renderReplay(app, record, onBack)` into `gameView.ts`'s `GameScreen` with a replay flag (controller already supports `previewPly` stepping); iOS: `GameView`/`GameViewModel` gain a browse-only `init(replay:)`. Replay mode: hides Resign / New Game / Undo / Hint / Auto-flip / Retry; shows First / Back / Forward / Last; **disables persistence** (it must not clobber `chessborder.savedGame`) and history recording. The replay controller always uses `localTwoPlayer` mode so no bot machinery can ever trigger (and the web GameController skips preloading the bot worker).
- **List rows show a result badge + metadata, NOT board thumbnails.** The spec said "mini thumbnail of the final position"; this plan consciously narrows that to a W/L/D badge (or 1–0 / 0–1 / ½ for pass-and-play), opponent/difficulty, date, and move count — ships faster, and the user can restore thumbnails later (the move list needed to render one is already in every record).
- **Merged history view:** signed-in users see cloud games plus local games under an "On this device" section — **no dedupe** between them (an online or uploaded game can appear in both). Flagged simplification; revisit with a content hash if it annoys.
- **Web online games also append to local history** (guests get online history too). Trigger: state transition `active` → `finished` observed by the client controller while holding a white/black role. Signed-in users will then have the cloud copy (server-written) AND a device copy — covered by the no-dedupe flag above.

## File Structure

| File | Responsibility |
|---|---|
| `server/accounts/src/protocol.ts` (modify) | `GameRecordInput`/`GameRecord` types, `parseGameRecordInput`, `statsKeyFor`. |
| `server/accounts/src/protocol.test.ts` (modify) | Parsing/validation/stats-key tests. |
| `server/accounts/src/store.ts` (modify) | `StoredGame`, `putGame`/`listGames`/`getGame`/`addStat` on `UserStore` + both impls; `stats: Record<string, number>`. |
| `server/accounts/src/store.test.ts` (create) | InMemory pagination/order/cursor tests. |
| `server/accounts/src/handler.ts` (modify) | Routes `POST /v1/games`, `GET /v1/games`, `GET /v1/games/{gameId}`; `HttpEvent` gains query/path params. |
| `server/accounts/src/handler.test.ts` (modify) | Route tests incl. auth, validation, pagination, stats. |
| `server/aws/accounts.yaml` (modify) | Three new routes; `dynamodb:Query` added to the Lambda policy. |
| `server/multiplayer/package.json` (modify) | Add `jose`. |
| `server/multiplayer/src/session.ts` (create) | Copied `verifySession` (explicit duplication; see decisions). |
| `server/multiplayer/src/session.test.ts` (create) | Verify round-trip/tamper/expiry against jose-minted tokens. |
| `server/multiplayer/src/room.ts` (modify) | `Seat.userId?`, `join(..., userId)`. |
| `server/multiplayer/src/store.ts` (modify) | `putConnectionUser`/`getConnectionUser` (`CONNUSER#` items) on both impls. |
| `server/multiplayer/src/record.ts` (create) | `UserGamesWriter`, `recordFinishedGame`, `DynamoUserGamesWriter` (users table). |
| `server/multiplayer/src/record.test.ts` (create) | Recording with a fake writer (both players, guest skip, stats keys). |
| `server/multiplayer/src/handler.ts` (modify) | `$connect` session verify; join carries userId; game-end recording hook. |
| `server/multiplayer/src/handler.test.ts` (modify) | `$connect`/attribution/record-once/rematch/failure-isolation tests. |
| `server/aws/multiplayer.yaml` (modify) | `UsersTableName` + `SessionJwtSecret` params, env vars, users-table IAM. |
| `server/aws/deploy-multiplayer.sh` (modify) | Read `/chess-border/accounts/jwt-secret` from SSM; pass as param (guard the `None` pitfall). |
| `web/src/game/gameHistory.ts` (create) | `CompletedGameRecord`, `appendGameToHistory` (cap 25 + dedupe), `loadGameHistory`, `completedGameRecord` builder, `resultLabel`. |
| `web/src/game/gameHistory.test.ts` (create) | Round-trip/cap/dedupe/builder/label tests. |
| `web/src/auth/api.ts` (modify) | Export `checkResponse` for reuse. |
| `web/src/auth/gamesApi.ts` (create) | `postGame`/`listGames`/`getGame` fetch client (injectable fetch). |
| `web/src/auth/gamesApi.test.ts` (create) | Request-shape + error tests. |
| `web/src/game/gameUploads.ts` (create) | Pending-upload queue + `uploadCompletedGame` + `flushPendingUploads`. |
| `web/src/game/gameUploads.test.ts` (create) | Queue/flush/drop-on-400/keep-on-network-error tests. |
| `web/src/ui/gameView.ts` (modify) | History hook in `maybePersist` path; `renderReplay` + replay mode. |
| `web/src/online/multiplayerController.ts` (modify) | Online active→finished history hook. |
| `web/src/online/multiplayerController.test.ts` (modify) | Transition-hook tests (injectable history append). |
| `web/src/ui/onlineGameView.ts` (modify) | Append `?session=` to the WS URL when signed in. |
| `web/src/ui/pastGamesView.ts` (create) | Past Games list screen (cloud + local sections, load-more). |
| `web/src/ui/home.ts` (modify) | "Past Games" action + `onPastGames` callback. |
| `web/src/main.ts` (modify) | `showPastGames` route, replay route, boot `flushPendingUploads()`. |
| `web/src/styles.css` (modify) | `.past-games*`, `.result-badge*` styles. |
| `ChessBorder/ChessBorder/Game/GameHistoryStore.swift` (create) | `CompletedGameRecord` Codable + rolling store (cap 25 + dedupe). |
| `ChessBorder/ChessBorder/Game/GameUploadQueue.swift` (create) | Pending-upload queue + flush. |
| `ChessBorder/ChessBorder/Auth/AccountsAPI.swift` (modify) | `postGame`/`listGames` + `GamePage`. |
| `ChessBorder/ChessBorder/Auth/AuthStore.swift` (modify) | `sessionToken` accessor. |
| `ChessBorder/ChessBorder/ViewModels/GameViewModel.swift` (modify) | `isReplay`, `init(replay:)`, history-record hook + upload. |
| `ChessBorder/ChessBorder/ViewModels/OnlineGameViewModel.swift` (modify) | `?session=` on connect URL; online history hook. |
| `ChessBorder/ChessBorder/Views/GameView.swift` (modify) | `init(replay:)`, replay chrome. |
| `ChessBorder/ChessBorder/Views/PastGamesView.swift` (create) | List screen (cloud + local sections). |
| `ChessBorder/ChessBorder/Views/HomeView.swift` (modify) | "Past Games" navigation entry; flush queue in `.task`. |
| `ChessBorder/ChessBorderTests/GameHistoryTests.swift` (create) | Store round-trip/cap/dedupe + record decode tests (Mac-runnable). |
| `scripts/verify-site.sh` (modify, final task) | Accounts block also smokes `GET /v1/games` → 401. |

## API contract (single source of truth for all packages)

```
POST /v1/games            Authorization: Bearer <session JWT>
                          body = GameRecordInput (any client-sent gameId is ignored)
                          → 200 {game: GameRecord} | 400 invalid record or mode "online" | 401
GET  /v1/games[?cursor=]  Bearer → 200 {games: GameRecord[], nextCursor: string|null} | 401
                          newest-first, page size 20; cursor is opaque; invalid cursor ⇒ first page
GET  /v1/games/{gameId}   Bearer → 200 {game: GameRecord} | 404 | 401

GameRecordInput = {
  mode: "vsBot" | "localTwoPlayer",          // "online" is server-written only
  difficulty: "easy"|"medium"|"hard"|null,   // required for vsBot, must be null otherwise
  playerColor: "white"|"black"|null,         // required for vsBot, null for localTwoPlayer
  opponent: string,                          // 1–40 chars after trim/collapse
  moves: string[],                           // 1–1024 UCI strings, each 2–8 chars
  resultType: "checkmate"|"stalemate"|"resignation"|"draw",
  winner: "white"|"black"|null,              // required for checkmate/resignation, null otherwise
  endedAt: string                            // ISO 8601; server clamps to <= now and re-serializes
}
GameRecord = GameRecordInput + { gameId: string }   // server-assigned UUID
```

DynamoDB items:

```
chess-border-users:
  USER#<userId> / GAME#<endedAtISO>#<gameId> → {gameId, mode, difficulty, playerColor,
                                                opponent, moves, resultType, winner, endedAt}
  USER#<userId> / META                       → stats gains flat number counters:
                                                bot_<easy|medium|hard>_<w|l|d>, online_<w|l|d>
chess-border-multiplayer:
  CONNUSER#<connectionId> / META             → {userId, ttl}   (verified session at $connect)
```

WebSocket connect: `wss://…/prod?session=<jwt>` (optional; absent/invalid ⇒ guest, never rejected).

Client storage keys: `chessborder.gameHistory`, `chessborder.pendingGameUploads` (web localStorage; iOS UserDefaults, same keys).

Local/iOS record shape mirrors `GameRecord` exactly (same field names), with `mode` additionally allowing `"online"`.

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/sahasra/Personal/work/chess-app
git checkout main && git pull && git checkout -b past-games
```

- [ ] **Step 2: Capture baselines** (expect 87 / 16 / 69 passing):

```bash
(cd server/accounts && npm test | tail -3)
(cd server/multiplayer && npm test | tail -3)
(cd web && npm test | tail -3)
```

---

### Task 1: Accounts protocol — game record types + validation (TDD)

**Files:** modify `server/accounts/src/protocol.ts`, `server/accounts/src/protocol.test.ts`.

- [ ] **Step 1: Write failing tests** covering `parseGameRecordInput`:
1. Valid vsBot record (medium, white, 3 moves, checkmate, winner white) → parsed; opponent trimmed/collapsed.
2. Valid localTwoPlayer record (difficulty null, playerColor null, stalemate, winner null) → parsed.
3. `mode: "online"` → null (server-written only). Unknown mode → null.
4. vsBot with `difficulty: null` → null; localTwoPlayer with a difficulty → null.
5. vsBot with `playerColor: null` → null.
6. Empty moves array → null; 1025 moves → null; a move of length 1 or 9 → null; non-string move → null.
7. `resultType: "checkmate"` with `winner: null` → null; `"draw"` with `winner: "white"` → null; `"resignation"` with winner → ok.
8. `endedAt: "not-a-date"` → null; valid ISO accepted.
9. Opponent empty after trim → null; 41 chars → null; extra unknown fields (e.g. a client `gameId`) are ignored.
And `statsKeyFor`: vsBot medium, white wins → `bot_medium_w`; white loses → `bot_medium_l`; stalemate → `bot_medium_d`; localTwoPlayer → null; vsBot with null playerColor → null.

- [ ] **Step 2: Implement** — append to `protocol.ts` (full code):

```ts
export type RecordableMode = "vsBot" | "localTwoPlayer";
export type GameResultType = "checkmate" | "stalemate" | "resignation" | "draw";
export type RecordColor = "white" | "black";

export interface GameRecordInput {
  mode: RecordableMode;
  difficulty: "easy" | "medium" | "hard" | null;
  playerColor: RecordColor | null;
  opponent: string;
  moves: string[];
  resultType: GameResultType;
  winner: RecordColor | null;
  endedAt: string; // ISO 8601
}

export interface GameRecord extends GameRecordInput {
  gameId: string;
}

export interface GamesPage {
  games: GameRecord[];
  nextCursor: string | null;
}

const MAX_MOVES = 1024;
const MAX_OPPONENT = 40;

/** Light validation per spec: shape + bounds, no server-side move replay. */
export function parseGameRecordInput(raw: string | undefined | null): GameRecordInput | null {
  const m = parseObject(raw);
  if (!m) return null;
  if (m.mode !== "vsBot" && m.mode !== "localTwoPlayer") return null;

  const difficulty =
    m.difficulty === "easy" || m.difficulty === "medium" || m.difficulty === "hard"
      ? m.difficulty
      : null;
  if (m.mode === "vsBot" && difficulty === null) return null;
  if (m.mode === "localTwoPlayer" && m.difficulty != null) return null;

  const playerColor = m.playerColor === "white" || m.playerColor === "black" ? m.playerColor : null;
  if (m.mode === "vsBot" && playerColor === null) return null;

  if (typeof m.opponent !== "string") return null;
  const opponent = m.opponent.replace(/\s+/g, " ").trim();
  if (opponent.length < 1 || opponent.length > MAX_OPPONENT) return null;

  if (!Array.isArray(m.moves) || m.moves.length < 1 || m.moves.length > MAX_MOVES) return null;
  if (!m.moves.every((mv) => typeof mv === "string" && mv.length >= 2 && mv.length <= 8)) {
    return null;
  }

  const resultType = m.resultType;
  if (
    resultType !== "checkmate" &&
    resultType !== "stalemate" &&
    resultType !== "resignation" &&
    resultType !== "draw"
  ) {
    return null;
  }
  const winner = m.winner === "white" || m.winner === "black" ? m.winner : null;
  const needsWinner = resultType === "checkmate" || resultType === "resignation";
  if (needsWinner && winner === null) return null;
  if (!needsWinner && winner !== null) return null;

  if (typeof m.endedAt !== "string" || Number.isNaN(Date.parse(m.endedAt))) return null;

  return {
    mode: m.mode,
    difficulty,
    playerColor,
    opponent,
    moves: m.moves as string[],
    resultType,
    winner,
    endedAt: m.endedAt,
  };
}

/** Flat stats counter key for a recorded game, or null when the game
 *  doesn't attribute a result to the user (pass-and-play). */
export function statsKeyFor(record: {
  mode: string;
  difficulty: string | null;
  playerColor: string | null;
  winner: string | null;
}): string | null {
  if (record.mode !== "vsBot" || !record.playerColor || !record.difficulty) return null;
  const outcome =
    record.winner == null ? "d" : record.winner === record.playerColor ? "w" : "l";
  return `bot_${record.difficulty}_${outcome}`;
}
```

(`parseObject` already exists in this file — reuse it.)

- [ ] **Step 3: Run + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/server/accounts && npm test
# expect: all pass (87 baseline + new protocol tests)
git add server/accounts/src/protocol.ts server/accounts/src/protocol.test.ts
git commit -m "$(cat <<'EOF'
Add game record types and validation to accounts protocol

GameRecordInput is validated lightly (shape and bounds, no move
replay). mode "online" is rejected here by design: online games are
written server-side by the multiplayer Lambda. statsKeyFor maps a
record to a flat stats counter key; pass-and-play games attribute no
result and return null.
EOF
)"
```

---

### Task 2: Accounts store — games + stats (TDD)

**Files:** modify `server/accounts/src/store.ts`; create `server/accounts/src/store.test.ts`.

- [ ] **Step 1: Write failing tests** (`store.test.ts`, against `InMemoryUserStore`):
1. `putGame` then `listGames(userId, 20, null)` → newest-first by `endedAt` (insert out of order; assert order).
2. Pagination: insert 25 games, `listGames(…, 20, null)` → 20 games + non-null cursor; second call with cursor → remaining 5 + null cursor.
3. Cursor garbage (`"!!!"`) → treated as first page (no throw).
4. `getGame` finds by gameId; unknown id → null; other user's id → null.
5. `addStat` twice on `bot_medium_w` → `getUser().stats.bot_medium_w === 2`; `addStat` for a missing user throws (InMemory) — handler treats stats as best-effort.
6. Same `endedAt`, different gameId → both stored (SK includes gameId).

- [ ] **Step 2: Implement.** In `store.ts`:

Change `UserRecord.stats` to `Record<string, number>` (update the doc comment: *"Flat counters: bot_<difficulty>_<w|l|d>, online_<w|l|d>. Phase 4 reads these."*). Add:

```ts
import type { GameRecord } from "./protocol";

export type StoredGame = GameRecord;

export interface GamePage {
  games: StoredGame[];
  nextCursor: string | null;
}

// added to the UserStore interface:
  putGame(userId: string, game: StoredGame): Promise<void>;
  /** Newest-first by endedAt. cursor is opaque; invalid cursors yield the first page. */
  listGames(userId: string, limit: number, cursor: string | null): Promise<GamePage>;
  getGame(userId: string, gameId: string): Promise<StoredGame | null>;
  /** Increment a flat stats counter by 1. Throws if the user item is missing. */
  addStat(userId: string, key: string): Promise<void>;
```

`InMemoryUserStore`: keep `private games = new Map<string, StoredGame[]>()` per user; sort key string `gameSk(g) = \`GAME#${g.endedAt}#${g.gameId}\``; `listGames` sorts descending by that key, applies cursor (cursor = the SK of the last returned item; return items with SK strictly less than it), slices `limit`, `nextCursor` = SK of the last returned item when more remain. `addStat`: `const u = this.users.get(userId); if (!u) throw …; u.stats[key] = (u.stats[key] ?? 0) + 1;`

`DynamoUserStore` (full code for the new methods):

```ts
  async putGame(userId: string, game: StoredGame): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `USER#${userId}`,
          SK: `GAME#${game.endedAt}#${game.gameId}`,
          ...game,
        },
      })
    );
  }

  async listGames(userId: string, limit: number, cursor: string | null): Promise<GamePage> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :game)",
        ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":game": "GAME#" },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor, `USER#${userId}`),
      })
    );
    return {
      games: (res.Items ?? []).map(itemToStoredGame),
      nextCursor: res.LastEvaluatedKey ? encodeCursor(res.LastEvaluatedKey) : null,
    };
  }

  async getGame(userId: string, gameId: string): Promise<StoredGame | null> {
    // No GSI: filter-scan the user's GAME# partition slice. Bounded by per-user
    // game counts; revisit with a GSI if users accumulate thousands of games.
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :game)",
          FilterExpression: "gameId = :id",
          ExpressionAttributeValues: {
            ":pk": `USER#${userId}`,
            ":game": "GAME#",
            ":id": gameId,
          },
          ExclusiveStartKey: startKey,
        })
      );
      if (res.Items && res.Items.length > 0) return itemToStoredGame(res.Items[0]);
      startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);
    return null;
  }

  async addStat(userId: string, key: string): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `USER#${userId}`, SK: "META" },
        UpdateExpression: "ADD stats.#k :one",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: { "#k": key },
        ExpressionAttributeValues: { ":one": 1 },
      })
    );
  }
```

Helpers (module-level in `store.ts`):

```ts
function itemToStoredGame(it: Record<string, unknown>): StoredGame {
  return {
    gameId: it.gameId as string,
    mode: it.mode as StoredGame["mode"],
    difficulty: (it.difficulty as StoredGame["difficulty"]) ?? null,
    playerColor: (it.playerColor as StoredGame["playerColor"]) ?? null,
    opponent: (it.opponent as string) ?? "",
    moves: (it.moves as string[]) ?? [],
    resultType: it.resultType as StoredGame["resultType"],
    winner: (it.winner as StoredGame["winner"]) ?? null,
    endedAt: (it.endedAt as string) ?? "",
  };
}

/** base64url(JSON LastEvaluatedKey). Shape-validated on decode; bad cursors ⇒ first page. */
export function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}
export function decodeCursor(
  cursor: string | null,
  expectedPk: string
): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const key = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (key.PK !== expectedPk || typeof key.SK !== "string") return undefined;
    return key;
  } catch {
    return undefined;
  }
}
```

Add `QueryCommand` to the `@aws-sdk/lib-dynamodb` import. Note: `StoredGame.mode` is `RecordableMode` via `GameRecord` — widen `GameRecord`'s use here by declaring `StoredGame` as `Omit<GameRecord, "mode"> & { mode: RecordableMode | "online" }` so server-written online games type-check on reads. Add a one-line comment that online items are written by the multiplayer Lambda.

`InMemoryUserStore`'s cursor is its own opaque string (the SK) — interface contract only promises opacity; tests in Step 1 exercise both pagination behaviors through the interface.

- [ ] **Step 3: Run + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/server/accounts && npm test && npm run typecheck
git add server/accounts/src/store.ts server/accounts/src/store.test.ts
git commit -m "$(cat <<'EOF'
Add game items and stats counters to the user store

GAME#<endedAtISO>#<gameId> items under USER#<id>, listed newest-first
with opaque cursor pagination (base64url LastEvaluatedKey; invalid
cursors fall back to the first page). getGame filters the user's GAME#
slice by gameId instead of adding a GSI. addStat increments flat
counters in the existing stats map. UserRecord.stats becomes
Record<string, number>.
EOF
)"
```

---

### Task 3: Accounts handler — games routes (TDD)

**Files:** modify `server/accounts/src/handler.ts`, `server/accounts/src/handler.test.ts`.

- [ ] **Step 1: Extend `HttpEvent`** (HTTP API payload v2 supplies both fields):

```ts
export interface HttpEvent {
  routeKey: string; // e.g. "POST /v1/games", "GET /v1/games/{gameId}"
  headers: Record<string, string | undefined>;
  body?: string | null;
  queryStringParameters?: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined>;
}
```

The Lambda `handler` entry's event type gains the same two optional fields (it already passes the raw event through).

- [ ] **Step 2: Write failing tests** (extend the existing `ev()` factory with optional query/path params):
1. `POST /v1/games` without Bearer → 401. Same for both GETs.
2. `POST /v1/games` valid vsBot body → 200, response `game.gameId` is a non-empty string the client didn't send, all input fields echoed.
3. `POST /v1/games` with `mode: "online"` → 400. Malformed body → 400.
4. `endedAt` in the future → stored game's `endedAt` is clamped to `now.toISOString()`.
5. After a won vsBot medium game → `store.getUser(...).stats.bot_medium_w === 1`; a localTwoPlayer game changes no stats.
6. A throwing `addStat` (stub store wrapper) still returns 200 (stats are best-effort).
7. `GET /v1/games` with 25 games → 20 newest-first + `nextCursor`; follow cursor → 5 + `nextCursor: null`. `?cursor=garbage` → first page.
8. `GET /v1/games/{gameId}` (event with `pathParameters: {gameId}`) → 200 for an owned game, 404 for unknown.

- [ ] **Step 3: Implement** — add to the `handleRequest` switch (before `default`):

```ts
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
```

Imports: `randomUUID` from `node:crypto`; `parseGameRecordInput`, `statsKeyFor` from `./protocol`; `StoredGame` type from `./store`.

- [ ] **Step 4: Run everything + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/server/accounts
npm test && npm run typecheck && npm run build
git add server/accounts/src/handler.ts server/accounts/src/handler.test.ts
git commit -m "$(cat <<'EOF'
Add games routes to the accounts Lambda

POST /v1/games stores a validated bot/local game under the session
user with a server-assigned gameId and clamps endedAt to the server
clock; bot stats counters update best-effort. GET /v1/games pages
newest-first (20, opaque cursor); GET /v1/games/{gameId} fetches one.
Online games never enter through this surface.
EOF
)"
```

---

### Task 4: Accounts CloudFormation — routes + Query IAM

**Files:** modify `server/aws/accounts.yaml`.

- [ ] **Step 1:** Add `dynamodb:Query` to the existing `dynamodb` policy's `Action` list.

- [ ] **Step 2:** Add three routes (same shape as the existing ones) and extend the Stage `DependsOn`:

```yaml
  GamesPostRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref HttpApi
      RouteKey: "POST /v1/games"
      Target: !Sub "integrations/${Integration}"

  GamesListRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref HttpApi
      RouteKey: "GET /v1/games"
      Target: !Sub "integrations/${Integration}"

  GameGetRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref HttpApi
      RouteKey: "GET /v1/games/{gameId}"
      Target: !Sub "integrations/${Integration}"
```

(Stage `DependsOn` gains `GamesPostRoute`, `GamesListRoute`, `GameGetRoute`. With payload v2 the Lambda receives `routeKey: "GET /v1/games/{gameId}"` literally plus `pathParameters.gameId` — exactly what Task 3 switches on. CORS `CorsConfiguration` already allows GET/POST + authorization header; no change.)

- [ ] **Step 3: Validate + commit**

```bash
AWS_PROFILE=sahasralabs aws cloudformation validate-template \
  --template-body file:///Users/sahasra/Personal/work/chess-app/server/aws/accounts.yaml \
  --region us-east-1
# expect: parameter listing (JwtSecret NoEcho). If creds unavailable, defer to Task 16 and note it.
git add server/aws/accounts.yaml
git commit -m "$(cat <<'EOF'
Add games routes and Query permission to accounts stack

GET /v1/games requires dynamodb:Query, which the Lambda role did not
previously have (it was GetItem/PutItem/UpdateItem only).
EOF
)"
```

---

### Task 5: Multiplayer — session verification (copied) (TDD)

**Files:** modify `server/multiplayer/package.json`; create `server/multiplayer/src/session.ts`, `server/multiplayer/src/session.test.ts`.

- [ ] **Step 1:** Add `"jose": "^5.9.6"` to `server/multiplayer/package.json` dependencies; `npm install --no-fund --no-audit`. (esbuild bundles it; only `@aws-sdk/*` stays external.)

- [ ] **Step 2: Write failing tests** — mint tokens directly with jose `SignJWT` (HS256, `sub`, `exp`): round-trip returns the userId; wrong secret rejects; expired rejects; missing `sub` rejects; token without `exp` rejects.

- [ ] **Step 3: Implement `session.ts`** — full file:

```ts
import { jwtVerify } from "jose";

// NOTE: deliberate copy of server/accounts/src/session.ts (verify half only).
// Two independently-deployed Lambdas sharing ~25 lines does not justify a
// shared package; extract if a third consumer appears. Keep in sync with
// the accounts issuer (HS256, sub = userId, exp required).
const ALG = "HS256";

/** Verify a session JWT and return the userId. Throws on any failure. */
export async function verifySession(secret: string, token: string): Promise<string> {
  if (!secret) throw new Error("session secret is not configured");
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, { algorithms: [ALG], requiredClaims: ["exp"] });
  if (!payload.sub) throw new Error("missing sub");
  return payload.sub;
}
```

- [ ] **Step 4: Run + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/server/multiplayer && npm test && npm run typecheck
git add server/multiplayer/package.json server/multiplayer/package-lock.json \
        server/multiplayer/src/session.ts server/multiplayer/src/session.test.ts
git commit -m "$(cat <<'EOF'
Add session JWT verification to the multiplayer Lambda

Deliberate ~25-line copy of the accounts verifySession (HS256,
sub=userId) rather than a shared package across independently
deployed Lambdas. Adds jose, bundled by esbuild.
EOF
)"
```

---

### Task 6: Multiplayer — seat attribution plumbing (TDD)

**Files:** modify `server/multiplayer/src/room.ts`, `server/multiplayer/src/store.ts`, `server/multiplayer/src/room.test.ts` (or wherever join is tested — follow the existing test layout).

- [ ] **Step 1: Write failing tests:**
1. `join` with `userId: "u1"` seats white with `userId === "u1"`; second player without a session seats black with no userId.
2. Reconnect (same token) with a userId sets it; reconnect with `null` userId **preserves** a previously set one (attribution is sticky for the game).
3. Spectator join with a userId does not crash and stores nothing on seats.
4. Store: `putConnectionUser`/`getConnectionUser` round-trip on `InMemoryRoomStore`; `getConnectionUser` for an unknown conn → null; `deleteConnection` also clears it.

- [ ] **Step 2: Implement.**

`room.ts` — `Seat` gains `userId?: string | null;` (optional: old persisted RoomStates lack it). `join` signature becomes:

```ts
export function join(
  prev: RoomState,
  connId: string,
  token: string,
  name: string,
  now: number,
  userId: string | null = null
): ReduceResult
```

In each seat-claim/reclaim branch, after the existing assignments: `if (userId) seat.userId = userId;` (never clears on null). `cloneRoom` already spreads seats — `userId` survives.

`store.ts` — `RoomStore` gains:

```ts
  /** Verified session user for a connection (written at $connect). */
  putConnectionUser(connectionId: string, userId: string): Promise<void>;
  getConnectionUser(connectionId: string): Promise<string | null>;
```

`InMemoryRoomStore`: a `Map<string, string>`; `deleteConnection` deletes from it too. `DynamoRoomStore`: item `PK: CONNUSER#<connId> / SK: META` with `userId` and the same 24h `ttl` as `CONN#`; `deleteConnection` issues a second `DeleteCommand` for the `CONNUSER#` key (TTL is the backstop).

- [ ] **Step 3: Run + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/server/multiplayer && npm test && npm run typecheck
git add server/multiplayer/src/room.ts server/multiplayer/src/store.ts server/multiplayer/src/*.test.ts
git commit -m "$(cat <<'EOF'
Carry verified user identity onto multiplayer seats

Seats gain an optional sticky userId, supplied at join from a
CONNUSER# record written at $connect. Guests are unchanged (null).
EOF
)"
```

---

### Task 7: Multiplayer — game recording (TDD)

**Files:** create `server/multiplayer/src/record.ts`, `server/multiplayer/src/record.test.ts`; modify `server/multiplayer/src/handler.ts`, `server/multiplayer/src/handler.test.ts`.

- [ ] **Step 1: Write failing tests.**

`record.test.ts` (fake writer capturing calls):
1. Finished room (checkmate, white wins) with both seats signed in → two `putGame` calls (one per userId) sharing the same `gameId`; white's record has `playerColor: "white"`, `opponent` = black's name, `winner: "white"`; stats `online_w` for white, `online_l` for black.
2. Stalemate → `winner: null`, both get `online_d`.
3. One guest seat → exactly one `putGame` + one `addStat`.
4. Both guests → no calls.
5. Room with `result.type === "ongoing"` → no calls (guard).
6. A throwing `putGame` for player one still attempts player two (per-player try/catch).

`handler.test.ts` additions (existing fakes + a fake writer in opts):
1. `$connect` with `queryStringParameters: {session: <valid>}` and an injected `verifySession` stub → `getConnectionUser` returns the userId; subsequent `join` produces a seat with that userId.
2. `$connect` with an invalid session (stub throws) → returns 200 OK, no CONNUSER record (guest; connection never rejected).
3. `$connect` with no opts.verifySession (secret unconfigured) → 200 OK, untouched.
4. A finishing move (drive a short scripted mate, or seed the room state two moves from mate and send the mating move) on a room with one signed-in seat → fake writer received the game; the move broadcast still went out.
5. The same finished room receiving a rematch then a new finishing move → writer called once per finished game (twice total).
6. A move on an already-finished room → error message, writer not called.
7. Writer that throws → move still broadcasts, handler returns 200.

- [ ] **Step 2: Implement `record.ts`** — full file:

```ts
import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { RoomState, Seat } from "./room";

/** Game item written to the USERS table (shape mirrors the accounts GameRecord). */
export interface OnlineGameRecord {
  gameId: string;
  mode: "online";
  difficulty: null;
  playerColor: "white" | "black";
  opponent: string;
  moves: string[];
  resultType: "checkmate" | "stalemate" | "resignation" | "draw";
  winner: "white" | "black" | null;
  endedAt: string;
}

export interface UserGamesWriter {
  putGame(userId: string, game: OnlineGameRecord): Promise<void>;
  addStat(userId: string, key: string): Promise<void>;
}

/** Record a finished online game for each signed-in seat. Per-player failures
 *  are isolated; callers additionally guard the whole call (recording must
 *  never break a move). Resignation cannot occur online today (no resign
 *  message) but is handled for forward-compat. */
export async function recordFinishedGame(
  writer: UserGamesWriter,
  state: RoomState,
  nowMs: number
): Promise<void> {
  if (state.result.type === "ongoing") return;
  const resultType = state.result.type;
  const winner = "winner" in state.result ? state.result.winner : null;
  const endedAt = new Date(nowMs).toISOString();
  const gameId = randomUUID();

  const seats: { color: "white" | "black"; seat: Seat | null; other: Seat | null }[] = [
    { color: "white", seat: state.white, other: state.black },
    { color: "black", seat: state.black, other: state.white },
  ];
  for (const { color, seat, other } of seats) {
    if (!seat?.userId) continue;
    try {
      await writer.putGame(seat.userId, {
        gameId,
        mode: "online",
        difficulty: null,
        playerColor: color,
        opponent: other?.name ?? "Opponent",
        moves: [...state.moves],
        resultType,
        winner,
        endedAt,
      });
      const key = winner == null ? "online_d" : winner === color ? "online_w" : "online_l";
      await writer.addStat(seat.userId, key);
    } catch (err) {
      console.error(`recordFinishedGame: failed for ${color}`, err);
    }
  }
}

/** Writes directly to the accounts users table (USERS_TABLE_NAME).
 *  Item shapes deliberately duplicate server/accounts/src/store.ts —
 *  keep PK/SK and attribute names in sync. */
export class DynamoUserGamesWriter implements UserGamesWriter {
  private readonly doc: DynamoDBDocumentClient;
  constructor(private readonly tableName: string, client?: DynamoDBClient) {
    this.doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}));
  }

  async putGame(userId: string, game: OnlineGameRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { PK: `USER#${userId}`, SK: `GAME#${game.endedAt}#${game.gameId}`, ...game },
      })
    );
  }

  async addStat(userId: string, key: string): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `USER#${userId}`, SK: "META" },
        UpdateExpression: "ADD stats.#k :one",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: { "#k": key },
        ExpressionAttributeValues: { ":one": 1 },
      })
    );
  }
}
```

(Phase 4 will turn the stats update into a transaction with a leaderboard GSI item; plain `UpdateItem` is the deliberate Phase 3 scope.)

- [ ] **Step 3: Wire `handler.ts`.**

```ts
export interface WsEvent {
  requestContext: { routeKey: string; connectionId: string; domainName?: string; stage?: string };
  queryStringParameters?: Record<string, string | undefined>;
  body?: string | null;
}

export interface HandlerOptions {
  /** Returns the userId for a valid session token; absent ⇒ sessions disabled. */
  verifySession?: (token: string) => Promise<string>;
  /** Absent ⇒ game recording disabled. */
  games?: UserGamesWriter;
}

export async function handleEvent(
  event: WsEvent,
  store: RoomStore,
  broadcaster: Broadcaster,
  now: number,
  opts: HandlerOptions = {}
): Promise<{ statusCode: number; body: string }>
```

(Existing 4-arg test calls still compile via the default.)

`$connect` branch becomes:

```ts
  if (routeKey === "$connect") {
    const session = event.queryStringParameters?.session;
    if (session && opts.verifySession) {
      try {
        const userId = await opts.verifySession(session);
        await store.putConnectionUser(connectionId, userId);
      } catch {
        // Invalid/expired session ⇒ guest seat (today's behavior); never reject.
      }
    }
    return OK;
  }
```

`join` branch: `const userId = await store.getConnectionUser(connectionId);` then `join(room, connectionId, msg.token, msg.name, now, userId)`.

Split the shared move/rematch tail so the move path can detect the finish transition:

```ts
  if (msg.type === "move") {
    const wasFinished = room.status === "finished";
    const result = move(room, connectionId, msg.uci, now);
    await store.putRoom(result.state);
    await sendAll(broadcaster, result.out);
    if (!wasFinished && result.state.status === "finished" && opts.games) {
      try {
        await recordFinishedGame(opts.games, result.state, now);
      } catch (err) {
        console.error("recordFinishedGame failed", err); // never fails the move
      }
    }
    return OK;
  }
  const result = rematch(room, connectionId, now);
  await store.putRoom(result.state);
  await sendAll(broadcaster, result.out);
  return OK;
```

Lambda entry:

```ts
let games: UserGamesWriter | null = null;

export async function handler(event: WsEvent) {
  store ??= new DynamoRoomStore(process.env.TABLE_NAME ?? "");
  const usersTable = process.env.USERS_TABLE_NAME ?? "";
  if (usersTable && !games) games = new DynamoUserGamesWriter(usersTable);
  const secret = process.env.SESSION_JWT_SECRET ?? "";
  const endpoint = /* unchanged */;
  return handleEvent(event, store, new ApiGatewayBroadcaster(endpoint), Date.now(), {
    verifySession: secret ? (t) => verifySession(secret, t) : undefined,
    games: games ?? undefined,
  });
}
```

- [ ] **Step 4: Run + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/server/multiplayer && npm test && npm run typecheck && npm run build
git add server/multiplayer/src/record.ts server/multiplayer/src/record.test.ts \
        server/multiplayer/src/handler.ts server/multiplayer/src/handler.test.ts
git commit -m "$(cat <<'EOF'
Record finished online games server-side

$connect verifies an optional session query param and stores the
userId for the connection; join copies it onto the seat. When a move
finishes the game, GAME# items and online stats counters are written
directly to the users table for each signed-in seat — after the
broadcast, isolated so recording can never break a move. Rematches
record again at their own finish; reconnects into finished rooms do
not re-record.
EOF
)"
```

---

### Task 8: Multiplayer infra — secret + users-table access

**Files:** modify `server/aws/multiplayer.yaml`, `server/aws/deploy-multiplayer.sh`.

- [ ] **Step 1: `multiplayer.yaml`.** Add parameters:

```yaml
  UsersTableName:
    Type: String
    Default: chess-border-users
    Description: Accounts users table that finished online games are written to
  SessionJwtSecret:
    Type: String
    NoEcho: true
    Default: ""
    Description: Accounts session-JWT secret (sourced from SSM by deploy-multiplayer.sh; empty disables recording)
```

Lambda `Environment.Variables` gains:

```yaml
          USERS_TABLE_NAME: !Ref UsersTableName
          SESSION_JWT_SECRET: !Ref SessionJwtSecret
```

`LambdaRole.Policies` gains (note: `!Sub` ARN, not `!GetAtt` — the table lives in the accounts stack):

```yaml
        - PolicyName: usersdynamodb
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - dynamodb:PutItem
                  - dynamodb:UpdateItem
                Resource: !Sub "arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${UsersTableName}"
```

- [ ] **Step 2: `deploy-multiplayer.sh`.** After the build, before the CFN deploy, read the same SSM param the accounts deploy owns and pass it through (mirrors the engine `API_KEY` handling — never pass a missing/`None` value, omit instead so the previous stack value is kept):

```bash
SECRET_PARAM="${ACCOUNTS_JWT_SECRET_PARAM:-/chess-border/accounts/jwt-secret}"
PARAMS=()
JWT_SECRET="$(aws ssm get-parameter \
  --name "$SECRET_PARAM" --with-decryption --region "$REGION" \
  --query 'Parameter.Value' --output text 2>/dev/null || true)"
if [[ -n "$JWT_SECRET" && "$JWT_SECRET" != "None" && ${#JWT_SECRET} -ge 32 ]]; then
  PARAMS+=(SessionJwtSecret="$JWT_SECRET")
else
  echo "WARN: $SECRET_PARAM not found in SSM - online game recording will stay disabled"
  echo "      (run server/aws/deploy-accounts.sh first to create it)"
fi
```

and change the deploy call to include the overrides only when present:

```bash
aws cloudformation deploy \
  --template-file "$ROOT/server/aws/multiplayer.yaml" \
  --stack-name "$STACK" \
  ${PARAMS[@]+--parameter-overrides "${PARAMS[@]}"} \
  --capabilities CAPABILITY_IAM \
  --region "$REGION" \
  --no-fail-on-empty-changeset
```

- [ ] **Step 3: Validate + commit**

```bash
bash -n /Users/sahasra/Personal/work/chess-app/server/aws/deploy-multiplayer.sh   # silent
AWS_PROFILE=sahasralabs aws cloudformation validate-template \
  --template-body file:///Users/sahasra/Personal/work/chess-app/server/aws/multiplayer.yaml \
  --region us-east-1
# expect: parameters incl. SessionJwtSecret NoEcho=true (defer if no creds)
git add server/aws/multiplayer.yaml server/aws/deploy-multiplayer.sh
git commit -m "$(cat <<'EOF'
Give the multiplayer stack the session secret and users-table access

SessionJwtSecret is read from the same SSM parameter the accounts
deploy owns and passed as a NoEcho parameter (omitted when SSM has no
value, keeping the previous stack value - same pitfall as the engine
API_KEY). IAM adds PutItem/UpdateItem on the users table by name, and
empty secret/table env vars leave the feature disabled.
EOF
)"
```

---

### Task 9: Web — local game history (TDD)

**Files:** create `web/src/game/gameHistory.ts`, `web/src/game/gameHistory.test.ts`; modify `web/src/ui/gameView.ts`.

- [ ] **Step 1: Write failing tests** (fake `StorageLike`, same pattern as `web/src/auth/session.test.ts`):
1. `appendGameToHistory` + `loadGameHistory` round-trip; newest first.
2. 26 appends → 25 kept, oldest dropped.
3. Duplicate append (same `mode`+`moves`+`resultType`, different `endedAt`/`gameId`) → returns false, not stored again.
4. Corrupt JSON / wrong version in storage → `loadGameHistory` returns `[]`; next append rewrites cleanly.
5. `completedGameRecord` from a `ChessGame` driven to checkmate (use a known quick mate over the 10×10 engine, or resign) → correct `moves` (UCI), `resultType`, `winner`; `ongoing` game → null.
6. `resultLabel`: vsBot win → `{text: "W", kind: "win"}`; loss → L/loss; draw → D/draw; localTwoPlayer white-wins → `{text: "1–0", kind: "neutral"}`; online with `playerColor` → W/L/D from that color's perspective.

- [ ] **Step 2: Implement `gameHistory.ts`** — full file:

```ts
import type { ChessGame } from "../engine/chessGame";
import type { BotDifficulty, GameMode, PieceColor } from "../engine/types";
import { moveUci } from "../engine/types";

export const GAME_HISTORY_KEY = "chessborder.gameHistory";
const HISTORY_VERSION = 1;
export const MAX_HISTORY_GAMES = 25;

export type HistoryGameMode = GameMode | "online";
export type GameResultType = "checkmate" | "stalemate" | "resignation" | "draw";

/** Mirrors the server GameRecord field-for-field (gameId is local for
 *  guest/device records and server-assigned for cloud copies). */
export interface CompletedGameRecord {
  gameId: string;
  mode: HistoryGameMode;
  difficulty: BotDifficulty | null;
  playerColor: PieceColor | null;
  opponent: string;
  moves: string[];
  resultType: GameResultType;
  winner: PieceColor | null;
  endedAt: string; // ISO 8601
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadGameHistory(storage: StorageLike = localStorage): CompletedGameRecord[] {
  try {
    const raw = storage.getItem(GAME_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { version?: unknown }).version !== HISTORY_VERSION ||
      !Array.isArray((parsed as { games?: unknown }).games)
    ) {
      return [];
    }
    return (parsed as { games: CompletedGameRecord[] }).games;
  } catch {
    return [];
  }
}

/** Prepend a completed game, capped at 25, newest first. Returns false (and
 *  stores nothing) when an existing entry has the same mode + moves +
 *  resultType — this guards reloading a finished saved game. endedAt is
 *  deliberately excluded from the dedupe key (it is rebuilt on restore). */
export function appendGameToHistory(
  record: CompletedGameRecord,
  storage: StorageLike = localStorage
): boolean {
  const games = loadGameHistory(storage);
  const movesKey = record.moves.join(" ");
  const dup = games.some(
    (g) => g.mode === record.mode && g.resultType === record.resultType && g.moves.join(" ") === movesKey
  );
  if (dup) return false;
  const next = [record, ...games].slice(0, MAX_HISTORY_GAMES);
  try {
    storage.setItem(GAME_HISTORY_KEY, JSON.stringify({ version: HISTORY_VERSION, games: next }));
  } catch {
    return false; // quota / private browsing — history is best-effort
  }
  return true;
}

/** Build a record from a finished game. Returns null while the game is ongoing. */
export function completedGameRecord(opts: {
  game: ChessGame;
  mode: HistoryGameMode;
  difficulty: BotDifficulty | null;
  playerColor: PieceColor | null;
  opponent: string;
  endedAt?: string;
}): CompletedGameRecord | null {
  const result = opts.game.result;
  if (result.type === "ongoing") return null;
  return {
    gameId: crypto.randomUUID(),
    mode: opts.mode,
    difficulty: opts.difficulty,
    playerColor: opts.playerColor,
    opponent: opts.opponent,
    moves: opts.game.recordedMoves.map((r) => moveUci(r.move)),
    resultType: result.type,
    winner: "winner" in result ? result.winner : null,
    endedAt: opts.endedAt ?? new Date().toISOString(),
  };
}

/** List-row badge for a record. kind drives the CSS class. */
export function resultLabel(record: CompletedGameRecord): {
  text: string;
  kind: "win" | "loss" | "draw" | "neutral";
} {
  if (record.playerColor == null) {
    // Pass-and-play: no owning side — show the score.
    if (record.winner === "white") return { text: "1–0", kind: "neutral" };
    if (record.winner === "black") return { text: "0–1", kind: "neutral" };
    return { text: "½", kind: "neutral" };
  }
  if (record.winner == null) return { text: "D", kind: "draw" };
  return record.winner === record.playerColor
    ? { text: "W", kind: "win" }
    : { text: "L", kind: "loss" };
}
```

- [ ] **Step 3: Hook the game-end transition in `gameView.ts`.** In `GameScreen`:
- New field `private historyRecorded = false;`
- `startNewGame()` adds `this.historyRecorded = false;` (next to the existing `lastPersistKey` reset).
- `maybePersist()` calls `this.maybeRecordHistory();` after `saveGameFromController(this.ctrl)` (so it fires on the same notify that flips the result — checkmate, resignation, draw — and also on restore of a finished game, where the store dedupe makes it a no-op):

```ts
  private maybeRecordHistory(): void {
    if (this.historyRecorded || this.ctrl.game.result.type === "ongoing") return;
    this.historyRecorded = true;
    const record = completedGameRecord({
      game: this.ctrl.game,
      mode: this.mode,
      difficulty: this.mode === "vsBot" ? this.difficulty : null,
      playerColor: this.mode === "vsBot" ? "white" : null,
      opponent: this.mode === "vsBot" ? `Bot (${this.difficulty})` : "Friend (local)",
    });
    if (record && appendGameToHistory(record)) {
      void uploadCompletedGame(record); // Task 10 — fire-and-forget, never throws
    }
  }
```

(Until Task 10 lands, stub `uploadCompletedGame` as a no-op import-free local — or simply add the call in Task 10; prefer the latter: this task commits only the local append.)

- [ ] **Step 4: Run + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/web && npm test && npx tsc --noEmit
git add web/src/game/gameHistory.ts web/src/game/gameHistory.test.ts web/src/ui/gameView.ts
git commit -m "$(cat <<'EOF'
Add rolling local game history on web

Completed bot and pass-and-play games append to
chessborder.gameHistory (last 25, newest first) from the existing
persist path, exactly once per game: an in-session flag covers the
live path and a mode+moves+resultType dedupe covers reloading a
finished saved game. Guests included.
EOF
)"
```

---

### Task 10: Web — cloud upload with retry queue (TDD)

**Files:** modify `web/src/auth/api.ts` (export `checkResponse`); create `web/src/auth/gamesApi.ts`, `web/src/auth/gamesApi.test.ts`, `web/src/game/gameUploads.ts`, `web/src/game/gameUploads.test.ts`; modify `web/src/ui/gameView.ts`, `web/src/main.ts`.

- [ ] **Step 1: `gamesApi.ts`** (TDD: fake fetch capturing URL/method/headers/body; non-2xx throws `AuthApiError` with status). Public surface:

```ts
import { AuthApiError, checkResponse } from "./api";
import type { CompletedGameRecord } from "../game/gameHistory";

export interface GamePage {
  games: CompletedGameRecord[];
  nextCursor: string | null;
}

export async function postGame(
  baseUrl: string, token: string, record: CompletedGameRecord, fetchImpl?: typeof fetch
): Promise<CompletedGameRecord>;          // POST /v1/games, Bearer; unwraps {game}

export async function listGames(
  baseUrl: string, token: string, cursor?: string | null, fetchImpl?: typeof fetch
): Promise<GamePage>;                     // GET /v1/games[?cursor=...] — encodeURIComponent the cursor

export async function getGame(
  baseUrl: string, token: string, gameId: string, fetchImpl?: typeof fetch
): Promise<CompletedGameRecord>;          // GET /v1/games/<id> — unwraps {game}
```

(Change `api.ts`'s `async function checkResponse` to `export async function checkResponse` — nothing else.)

- [ ] **Step 2: `gameUploads.ts`** (TDD). One shared mechanism: *enqueue, then flush* — success and retry are the same code path.

```ts
import { ACCOUNTS_API_URL } from "../auth/config";
import { getSessionToken } from "../auth/session";
import { postGame } from "../auth/gamesApi";
import { AuthApiError } from "../auth/api";
import type { CompletedGameRecord } from "./gameHistory";

export const PENDING_UPLOADS_KEY = "chessborder.pendingGameUploads";
const MAX_PENDING = 10;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface UploadDeps {
  storage?: StorageLike;
  fetchImpl?: typeof fetch;
  baseUrl?: string;          // defaults to ACCOUNTS_API_URL
  getToken?: () => string | null; // defaults to getSessionToken
}

/** Queue a finished game and try to flush. No-ops for guests, for online
 *  games (server-recorded), and when accounts aren't configured. Never throws. */
export async function uploadCompletedGame(record: CompletedGameRecord, deps?: UploadDeps): Promise<void>;

/** Drain the queue in order. Per entry: success or 400 (permanently invalid)
 *  ⇒ remove; 401 or network error ⇒ stop and keep the rest for the next
 *  boot/sign-in. Never throws. Call once at boot. */
export async function flushPendingUploads(deps?: UploadDeps): Promise<void>;
```

Behavior to implement and test:
1. Guest (`getToken` → null) → `uploadCompletedGame` stores nothing, no fetch.
2. `record.mode === "online"` → stored nothing (server-side recorded).
3. Signed-in + fetch ok → queue empty afterwards, one POST with Bearer.
4. Fetch network reject → record remains queued; second `flushPendingUploads` with a working fetch drains it.
5. 400 response → entry dropped (won't retry forever); 401 → entry kept.
6. Queue caps at 10 (11th enqueue drops the oldest).
7. Queue persists as a JSON array of records under `PENDING_UPLOADS_KEY`; corrupt JSON resets to empty.

- [ ] **Step 3: Wire callers.**
- `gameView.ts` `maybeRecordHistory()` (Task 9) gains the `void uploadCompletedGame(record);` call inside the `appendGameToHistory` success branch.
- `main.ts`: after `initAnalytics` boot line add

```ts
void import("./game/gameUploads").then(({ flushPendingUploads }) => flushPendingUploads());
```

- [ ] **Step 4: Run + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/web && npm test && npx tsc --noEmit
git add web/src/auth/api.ts web/src/auth/gamesApi.ts web/src/auth/gamesApi.test.ts \
        web/src/game/gameUploads.ts web/src/game/gameUploads.test.ts \
        web/src/ui/gameView.ts web/src/main.ts
git commit -m "$(cat <<'EOF'
Upload finished games to the accounts API with a retry queue

Game end enqueues to chessborder.pendingGameUploads and flushes
immediately; boot flushes leftovers, so success and retry share one
mechanism. 400s drop the entry, 401/network keep it. Guests and
online games (server-recorded) never enqueue.
EOF
)"
```

---

### Task 11: Web — online session attribution + online local history (TDD)

**Files:** modify `web/src/ui/onlineGameView.ts`, `web/src/online/multiplayerController.ts`, `web/src/online/multiplayerController.test.ts`.

- [ ] **Step 1: Session on the WS URL** (`onlineGameView.ts`). The controller receives a prebuilt URL, so append there:

```ts
import { getSessionToken } from "../auth/session";

function wsUrlWithSession(base: string): string {
  const token = getSessionToken();
  if (!token) return base;
  return `${base}${base.includes("?") ? "&" : "?"}session=${encodeURIComponent(token)}`;
}
```

and pass `wsUrlWithSession(WS_URL as string)` into the `MultiplayerController` constructor. (No UI change; invalid/expired tokens degrade to a guest seat server-side.)

- [ ] **Step 2: Online history hook** (`multiplayerController.ts`, TDD via the existing fake-socket tests). Constructor gains an optional injectable recorder so tests don't touch localStorage:

```ts
    private readonly recordHistory: (state: StateMessage, game: ChessGame) => void = defaultRecordHistory,
```

In `applyState`, before `this.state = msg`, capture `const prevStatus = this.firstState ? null : this.state?.status ?? null;` and after `rebuild(...)`:

```ts
    if (
      prevStatus === "active" &&
      msg.status === "finished" &&
      (msg.role === "white" || msg.role === "black")
    ) {
      try {
        this.recordHistory(msg, this.game);
      } catch {
        // History is best-effort; never break the game screen.
      }
    }
```

`defaultRecordHistory` (module-level): builds via `completedGameRecord({game, mode: "online", difficulty: null, playerColor: msg.color, opponent: <other color's players name ?? "Opponent">})` and calls `appendGameToHistory(record)`. **No upload** — signed-in users' online games are recorded server-side; this is the device copy only.

Tests (extend `multiplayerController.test.ts`, injecting a capturing recorder):
1. active → finished as white → recorder called once with the finished state.
2. Connecting straight into a finished room (first state finished) → not called.
3. Spectator role → not called.
4. Rematch (finished → active, moves reset) then a second finish → called again (twice total).

- [ ] **Step 3: Run + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/web && npm test && npx tsc --noEmit
git add web/src/ui/onlineGameView.ts web/src/online/multiplayerController.ts \
        web/src/online/multiplayerController.test.ts
git commit -m "$(cat <<'EOF'
Attribute online connects and record online games locally on web

The WebSocket URL carries ?session= when signed in so the server can
attribute the seat. The client appends finished online games to local
history on the active-to-finished transition (players only, once per
game, guests included); the cloud copy is written server-side.
EOF
)"
```

---

### Task 12: Web — Past Games screen + replay viewer

**Files:** create `web/src/ui/pastGamesView.ts`; modify `web/src/ui/gameView.ts`, `web/src/ui/home.ts`, `web/src/main.ts`, `web/src/styles.css`. (DOM-heavy — no unit tests, same policy as `home.ts`; the logic lives in Tasks 9–10 modules.)

- [ ] **Step 1: Replay mode in `gameView.ts`.** New export:

```ts
export function renderReplay(
  root: HTMLElement,
  record: CompletedGameRecord,
  onBack: () => void
): () => void {
  const screen = new GameScreen(root, "localTwoPlayer", "medium", onBack, undefined, record);
  screen.mount();
  return () => screen.destroy();
}
```

`GameScreen` constructor gains a final optional `private readonly replay?: CompletedGameRecord`. Behavior in replay mode (enumerated; implement inside the existing methods with `if (this.replay)` branches):
- **Restore:** build a `SavedGameSnapshot` literal from the record — `{version: 1, mode: "localTwoPlayer", botDifficulty: "medium", moves: record.moves, resignedBy: record.resultType === "resignation" && record.winner ? (record.winner === "white" ? "black" : "white") : null, boardFlipped: record.playerColor === "black", autoFlipBoard: false}` — and feed it through the existing `restoreGameFromSnapshot` + `ctrl.restoreGame` path. Mode is always `localTwoPlayer` so no bot machinery (or worker preload) can run; the finished result also makes `isBotTurn` false.
- **Persistence/history OFF:** `maybePersist()` returns immediately when `this.replay` is set (a replay must never clobber `chessborder.savedGame` or re-append history).
- **Chrome:** header title `Replay`; `h2` text `Replay — ${record.opponent}`; do not create Auto-flip/Hint; hide (don't create) Undo, Retry, Resign, New Game. Controls row: **First** (`ctrl.goToMove(0)`), the existing ◀ ▶, and **Last** (`ctrl.returnToLive()`; reuse the Live button with the label `Last`). Keep Flip and the mute button.
- **No game-over overlay:** initialize `gameOverDismissed = true` in replay (status bar already shows "Checkmate. White wins" etc. at the final position; "Reviewing move N of M" while stepping).
- Back button label `← Back`, wired to `onBack` (returns to the list, not home).

- [ ] **Step 2: `pastGamesView.ts`.** Export:

```ts
export function renderPastGames(
  root: HTMLElement,
  onBack: () => void,
  onOpenReplay: (record: CompletedGameRecord) => void
): () => void
```

Behavior:
- Header: back button → `onBack`, `h2` "Past Games".
- **Signed-in** (`isAuthConfigured && getSessionToken()`): fetch `listGames(ACCOUNTS_API_URL!, token)`; render rows in a "Your games" section; a "Load more" button appears while `nextCursor` is non-null and appends the next page. On any fetch error show a muted one-liner ("Couldn't load cloud games — showing this device only.") and fall through to local.
- **Always:** a second section "On this device" with `loadGameHistory()` rows (omit the section when empty; for guests it's the only section). No dedupe between sections (flagged decision).
- Row: `resultLabel(record)` badge (`span.result-badge.{win|loss|draw|neutral}`), opponent (+ ` · ${difficulty}` for vsBot), `new Date(endedAt).toLocaleDateString()`, `${moves.length} moves`. Click → `onOpenReplay(record)`. No thumbnails (flagged spec narrowing).
- Empty everything → "No finished games yet — play one!"
- Return a destroy fn that clears `root` and aborts any in-flight fetch (AbortController, matching existing patterns).

- [ ] **Step 3: Home + routing.** `home.ts`: `renderHome` gains a fourth param `onPastGames: () => void`; under the existing `actions` children append a `Past Games` button (plain, non-primary). `main.ts`:

```ts
  function showPastGames(): void {
    void import("./ui/pastGamesView").then(({ renderPastGames }) => {
      teardownGame?.();
      teardownGame = renderPastGames(app, showHome, showReplay);
    }).catch(...)  // mirror startGame's error handling
  }
  function showReplay(record: CompletedGameRecord): void {
    void import("./ui/gameView").then(({ renderReplay }) => {
      teardownGame?.();
      teardownGame = renderReplay(app, record, showPastGames);
    }).catch(...)
  }
```

and pass `showPastGames` into `renderHome`.

- [ ] **Step 4: `styles.css`** — `.past-games` (list container, matches `.home-actions` width), `.past-game-row` (flex row, surface background, pointer), `.result-badge` (fixed-width disc; `.win` green, `.loss` red, `.draw`/`.neutral` muted), `.past-games-note` (muted). Follow existing custom-property usage.

- [ ] **Step 5: Verify manually + typecheck + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/web
npm test && npx tsc --noEmit
# npm run dev → finish a quick game (resign) → Home → Past Games shows it →
# tap row → replay opens read-only at the final position; First/◀/▶/Last step;
# no Resign/New Game/Hint; Back returns to the list; reload → chessborder.savedGame
# still holds the *resumable* slot, not the replay.
git add web/src/ui/pastGamesView.ts web/src/ui/gameView.ts web/src/ui/home.ts \
        web/src/main.ts web/src/styles.css
git commit -m "$(cat <<'EOF'
Add Past Games screen and replay viewer on web

The list shows cloud games when signed in plus an on-device section
(result badge, opponent, date, move count - thumbnails consciously
deferred). Replay reuses the existing game view in a read-only mode:
First/Back/Forward/Last over the controller's previewPly stepping,
with resign/new-game/hint hidden and persistence disabled.
EOF
)"
```

---

### Task 13: iOS — local history store + game-end hook (TDD)

**Files:** create `ChessBorder/ChessBorder/Game/GameHistoryStore.swift`, `ChessBorder/ChessBorderTests/GameHistoryTests.swift`; modify `ChessBorder/ChessBorder/ViewModels/GameViewModel.swift`, `ChessBorder/ChessBorder/Views/GameView.swift`.

- [ ] **Step 1: `GameHistoryStore.swift`** — full file:

```swift
import Foundation

/// Mirrors the web/server GameRecord field-for-field.
struct CompletedGameRecord: Codable, Equatable, Identifiable {
    let gameId: String
    let mode: String           // "vsBot" | "localTwoPlayer" | "online"
    let difficulty: String?    // easy | medium | hard (vsBot only)
    let playerColor: String?   // white | black | nil (pass-and-play)
    let opponent: String
    let moves: [String]
    let resultType: String     // checkmate | stalemate | resignation | draw
    let winner: String?        // white | black | nil
    let endedAt: String        // ISO 8601

    var id: String { gameId }
}

/// Rolling last-25 completed games (guests included), newest first.
enum GameHistoryStore {
    static let maxGames = 25
    private static let key = "chessborder.gameHistory"
    private static let version = 1

    private struct HistoryFile: Codable {
        let version: Int
        var games: [CompletedGameRecord]
    }

    static func load(defaults: UserDefaults = .standard) -> [CompletedGameRecord] {
        guard let data = defaults.data(forKey: key),
              let file = try? JSONDecoder().decode(HistoryFile.self, from: data),
              file.version == version else { return [] }
        return file.games
    }

    /// Prepend, capped at 25. Returns false (storing nothing) when an entry
    /// with the same mode + moves + resultType already exists — guards
    /// re-recording a finished game restored from the resume slot. endedAt is
    /// deliberately excluded from the dedupe key.
    @discardableResult
    static func append(_ record: CompletedGameRecord, defaults: UserDefaults = .standard) -> Bool {
        var games = load(defaults: defaults)
        let dup = games.contains {
            $0.mode == record.mode && $0.resultType == record.resultType && $0.moves == record.moves
        }
        if dup { return false }
        games.insert(record, at: 0)
        if games.count > maxGames { games.removeLast(games.count - maxGames) }
        guard let data = try? JSONEncoder().encode(HistoryFile(version: version, games: games)) else {
            return false
        }
        defaults.set(data, forKey: key)
        return true
    }

    static func clear(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: key)
    }
}
```

- [ ] **Step 2: `GameViewModel` hook + replay support.** Additions:
- `let isReplay: Bool` — `false` in both existing inits; new init:

```swift
    /// Browse-only replay of a completed game. No bot, no persistence.
    init(replay record: CompletedGameRecord) {
        self.mode = .localTwoPlayer   // never schedules the bot
        self.botDifficulty = .medium
        self.isReplay = true
        let game = ChessGame()
        for uci in record.moves {
            guard let move = game.move(from: uci), game.applyMove(move) else { break }
        }
        if record.resultType == "resignation", let winner = record.winner {
            game.resign(by: winner == "white" ? .black : .white)
        }
        self.game = game
        self.boardFlipped = record.playerColor == "black"
        self.autoFlipBoard = false
    }
```

- `private var historyRecorded = false` — reset to `false` in `newGame()`.
- `persistIfNeeded()` gains `guard !isReplay else { return }`.
- `notifyChange()` calls `recordHistoryIfFinished()` after `persistIfNeeded()`; also call it from `finishRestoringSavedGameIfNeeded()` (covers a finished game restored from the resume slot — the store dedupe makes repeats a no-op):

```swift
    func recordHistoryIfFinished() {
        guard !isReplay, !historyRecorded, game.result != .ongoing else { return }
        historyRecorded = true
        guard let record = completedRecord() else { return }
        if GameHistoryStore.append(record) {
            GameUploadQueue.enqueueAndFlush(record)   // Task 14; until then omit this line
        }
    }

    private func completedRecord() -> CompletedGameRecord? {
        let (resultType, winner): (String, String?) = {
            switch game.result {
            case .ongoing: return ("", nil)
            case .checkmate(let w): return ("checkmate", w == .white ? "white" : "black")
            case .resignation(let w): return ("resignation", w == .white ? "white" : "black")
            case .stalemate: return ("stalemate", nil)
            case .draw: return ("draw", nil)
            }
        }()
        guard !resultType.isEmpty else { return nil }
        let vsBot = mode == .vsBot
        return CompletedGameRecord(
            gameId: UUID().uuidString,
            mode: vsBot ? "vsBot" : "localTwoPlayer",
            difficulty: vsBot ? botDifficulty.rawValue.lowercased() : nil,
            playerColor: vsBot ? "white" : nil,
            opponent: vsBot ? "Bot (\(botDifficulty.rawValue.lowercased()))" : "Friend (local)",
            moves: game.recordedMoves.map(\.move.uci),
            resultType: resultType,
            winner: winner,
            endedAt: ISO8601DateFormatter().string(from: Date())
        )
    }
```

(Match the actual `GameResult` enum cases when implementing — check whether `.draw` carries a reason payload and pattern-match accordingly.)

- [ ] **Step 3: `GameView` replay chrome.** Add `private let isReplay: Bool` (false in existing inits) and:

```swift
    init(replay record: CompletedGameRecord) {
        _viewModel = StateObject(wrappedValue: GameViewModel(replay: record))
        onReturnHome = nil
        isReplay = true
        _gameOverDismissed = State(initialValue: true)
    }
```

In `body`/subviews gate on `isReplay`: header title `"Replay"` (subtitle = opponent); hide Auto-flip, Hint, Resign, New Game, Undo, Retry (keep Flip, sound, gear); the tool strip keeps ◀ ▶ and gains a First button (`viewModel.goToMove(ply: 0)`) and relabels Live → `"Last"`; the game-over overlay additionally requires `!isReplay`.

- [ ] **Step 4: `GameHistoryTests.swift`** (Mac-runnable, `UserDefaults(suiteName:)` with cleanup): round-trip newest-first; 26 appends → 25; duplicate (same mode/moves/resultType, different endedAt) → `append` returns false; corrupt data → `load` returns `[]`; `CompletedGameRecord` decodes from a fixture JSON matching the server contract (incl. `difficulty: null`).

- [ ] **Step 5: Build + test + commit** (new files are picked up by the `sources:` glob, but the project must be regenerated — defer the single `xcodegen generate` to Task 15 if preferred; if running tests now, regen with the Task 15 gotchas):

```bash
cd /Users/sahasra/Personal/work/chess-app/ChessBorder
xcodegen generate   # then: restore Mac scheme BuildableName + check Info.plist version keys (see Task 15)
xcodebuild -project ChessBorder.xcodeproj -scheme ChessBorderMac test | tail -5
# expect: only the pre-existing OnlineTests border-move failure; GameHistoryTests pass
git add ChessBorder/ChessBorder/Game/GameHistoryStore.swift \
        ChessBorder/ChessBorderTests/GameHistoryTests.swift \
        ChessBorder/ChessBorder/ViewModels/GameViewModel.swift \
        ChessBorder/ChessBorder/Views/GameView.swift ChessBorder/ChessBorder.xcodeproj
git commit -m "$(cat <<'EOF'
Add rolling local game history and replay mode on iOS

GameHistoryStore mirrors the web store (last 25, newest first,
mode+moves+resultType dedupe) on UserDefaults. GameViewModel records
once per finished game from notifyChange, and gains a browse-only
init(replay:) that never persists or schedules the bot; GameView
hides resign/new-game/hint/undo in replay and adds First/Last
stepping.
EOF
)"
```

---

### Task 14: iOS — cloud upload + online attribution

**Files:** create `ChessBorder/ChessBorder/Game/GameUploadQueue.swift`; modify `ChessBorder/ChessBorder/Auth/AccountsAPI.swift`, `Auth/AuthStore.swift`, `ViewModels/GameViewModel.swift` (one line from Task 13), `ViewModels/OnlineGameViewModel.swift`, `Views/HomeView.swift`.

- [ ] **Step 1: `AccountsAPI` additions** (same request style as the existing methods):

```swift
struct GamePage: Codable {
    let games: [CompletedGameRecord]
    let nextCursor: String?
}
private struct GameEnvelope: Codable { let game: CompletedGameRecord }

    /// POST /v1/games (Bearer). The server assigns its own gameId.
    func postGame(token: String, record: CompletedGameRecord) async throws -> CompletedGameRecord
    /// GET /v1/games[?cursor=] (Bearer)
    func listGames(token: String, cursor: String?) async throws -> GamePage
```

`postGame` encodes the record with `JSONEncoder` (server ignores the client `gameId`), decodes `GameEnvelope`. `listGames` appends `?cursor=` via `URLComponents` when present, decodes `GamePage` directly. Both throw `.http(status)` on non-2xx like the existing methods.

- [ ] **Step 2: `AuthStore`** gains a token accessor for other modules:

```swift
    /// Stored session token, if any (for WebSocket attribution and game uploads).
    var sessionToken: String? { KeychainStore.read(Self.tokenAccount) }
```

- [ ] **Step 3: `GameUploadQueue.swift`** — full file:

```swift
import Foundation

/// Pending cloud uploads for finished bot/local games (signed-in users only).
/// One shared mechanism: game end enqueues + flushes; launch flushes leftovers.
enum GameUploadQueue {
    private static let key = "chessborder.pendingGameUploads"
    private static let maxPending = 10

    static func load(defaults: UserDefaults = .standard) -> [CompletedGameRecord] {
        guard let data = defaults.data(forKey: key),
              let records = try? JSONDecoder().decode([CompletedGameRecord].self, from: data)
        else { return [] }
        return records
    }

    private static func save(_ records: [CompletedGameRecord], defaults: UserDefaults = .standard) {
        guard let data = try? JSONEncoder().encode(records) else { return }
        defaults.set(data, forKey: key)
    }

    /// Queue and immediately attempt upload. No-ops for guests, online games,
    /// or unconfigured accounts. Never throws, never blocks the caller.
    @MainActor
    static func enqueueAndFlush(_ record: CompletedGameRecord, defaults: UserDefaults = .standard) {
        guard record.mode != "online",
              AccountsConfig.isConfigured,
              AuthStore.shared.sessionToken != nil else { return }
        var queue = load(defaults: defaults)
        queue.append(record)
        if queue.count > maxPending { queue.removeFirst(queue.count - maxPending) }
        save(queue, defaults: defaults)
        Task { await flush(defaults: defaults) }
    }

    /// Drain in order. Success or HTTP 400 (permanently invalid) removes the
    /// entry; 401/network errors stop and keep the rest for the next launch.
    @MainActor
    static func flush(defaults: UserDefaults = .standard) async {
        guard let url = AccountsConfig.serverURL,
              let token = AuthStore.shared.sessionToken else { return }
        let api = AccountsAPI(baseURL: url)
        var queue = load(defaults: defaults)
        while let next = queue.first {
            do {
                _ = try await api.postGame(token: token, record: next)
                queue.removeFirst()
            } catch AccountsAPIError.http(400) {
                queue.removeFirst()
            } catch {
                break
            }
            save(queue, defaults: defaults)
        }
        save(queue, defaults: defaults)
    }
}
```

- [ ] **Step 4: Hooks.**
- `GameViewModel.recordHistoryIfFinished()`: enable the `GameUploadQueue.enqueueAndFlush(record)` line from Task 13.
- `HomeView`: in the existing `.task { await auth.restore() }` add `await GameUploadQueue.flush()` after the restore (launch-time drain).
- `OnlineGameViewModel.init`: attach the session before connecting —

```swift
        guard var url = MultiplayerConfig.serverURL else { return }
        if let token = AuthStore.shared.sessionToken,
           var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            comps.queryItems = (comps.queryItems ?? []) + [URLQueryItem(name: "session", value: token)]
            url = comps.url ?? url
        }
        let socket = OnlineSocket(url: url)
```

- `OnlineGameViewModel.handle(_:)` for `.state`: capture `let prevStatus = firstState ? nil : state?.status` before assigning; after applying the new state, when `prevStatus == "active" && newState.status == "finished" && (newState.role == .white || newState.role == .black)`, build a `CompletedGameRecord` (`mode: "online"`, `playerColor` from `newState.color`, opponent = other color's player name ?? "Opponent", `moves: newState.moves`, `resultType: newState.result.type`, `winner: newState.result.winner`, fresh `endedAt`) and `GameHistoryStore.append(...)` — local copy only, **no upload** (server-recorded).

- [ ] **Step 5: Build + commit**

```bash
cd /Users/sahasra/Personal/work/chess-app/ChessBorder
xcodebuild -project ChessBorder.xcodeproj -scheme ChessBorder \
  -destination 'generic/platform=iOS Simulator' build | tail -3   # BUILD SUCCEEDED
xcodebuild -project ChessBorder.xcodeproj -scheme ChessBorderMac test | tail -3
# expect: only the pre-existing OnlineTests failure
git add ChessBorder/ChessBorder/Game/GameUploadQueue.swift \
        ChessBorder/ChessBorder/Auth/AccountsAPI.swift ChessBorder/ChessBorder/Auth/AuthStore.swift \
        ChessBorder/ChessBorder/ViewModels/GameViewModel.swift \
        ChessBorder/ChessBorder/ViewModels/OnlineGameViewModel.swift \
        ChessBorder/ChessBorder/Views/HomeView.swift
git commit -m "$(cat <<'EOF'
Upload finished games and attribute online seats on iOS

GameUploadQueue mirrors the web retry queue (enqueue+flush on game
end, flush on launch, 400 drops, 401/network keeps). The online
socket URL carries ?session= when signed in, and finished online
games append to local history on the active-to-finished transition;
their cloud copy is written server-side.
EOF
)"
```

---

### Task 15: iOS — Past Games screen + navigation + xcodegen

**Files:** create `ChessBorder/ChessBorder/Views/PastGamesView.swift`; modify `ChessBorder/ChessBorder/Views/HomeView.swift`; regenerate the Xcode project.

- [ ] **Step 1: `PastGamesView.swift`.** SwiftUI screen matching the app chrome (`BoardTheme.background`, `GameSurfaceCard`-style rows). Structure:
- `@State private var cloudGames: [CompletedGameRecord] = []`, `@State private var nextCursor: String?`, `@State private var cloudError = false`, `@State private var localGames: [CompletedGameRecord] = []`.
- `.task`: `localGames = GameHistoryStore.load()`; if `AccountsConfig.isConfigured`, `let token = AuthStore.shared.sessionToken` → `listGames(token:cursor:nil)` into `cloudGames`/`nextCursor`; failures set `cloudError = true` (muted "Couldn't load cloud games" caption) — local always shows.
- Sections: "Your games" (cloud, signed-in only) with a "Load more" row while `nextCursor != nil`; "On this device" (local; the only section for guests). No dedupe across sections (flagged decision).
- Row: result badge (W/L/D from `playerColor`/`winner`; `1–0`/`0–1`/`½` when `playerColor == nil` — mirror web `resultLabel`), opponent (+ difficulty), formatted date (parse `endedAt` with `ISO8601DateFormatter`), `\(moves.count) moves`. Row is a `NavigationLink { GameView(replay: record) }`.
- Empty state: "No finished games yet — play one!"

- [ ] **Step 2: HomeView entry.** Below the modes `VStack` (inside the `NavigationStack`), add a plain-styled `NavigationLink("Past Games") { PastGamesView() }` using the small text-action look (`.font(.subheadline)`, white 0.7 opacity) so it reads as a secondary action.

- [ ] **Step 3: Regenerate + KNOWN XCODEGEN GOTCHAS:**

```bash
cd /Users/sahasra/Personal/work/chess-app/ChessBorder
xcodegen generate
git diff --stat
```

After EVERY `xcodegen generate`:
1. **Restore the Mac scheme's BuildableName** if rewritten: `git checkout -- ChessBorder.xcodeproj/xcshareddata/xcschemes/ChessBorderMac.xcscheme` (tracked value is `Border Chess.app`).
2. **Revert any Info.plist version-key drift** (`CFBundleShortVersionString`/`CFBundleVersion`) in `ChessBorder/Info.plist` / `Info-mac.plist` — `project.yml` is the source of truth.

- [ ] **Step 4: Build + test + commit**

```bash
xcodebuild -project ChessBorder.xcodeproj -scheme ChessBorder \
  -destination 'generic/platform=iOS Simulator' build | tail -3   # BUILD SUCCEEDED
xcodebuild -project ChessBorder.xcodeproj -scheme ChessBorderMac test | tail -3
# expect: TEST FAILED with ONLY the pre-existing OnlineTests border-move failure
git add ChessBorder/ChessBorder/Views/PastGamesView.swift ChessBorder/ChessBorder/Views/HomeView.swift \
        ChessBorder/ChessBorder.xcodeproj
git commit -m "$(cat <<'EOF'
Add Past Games screen on iOS

Lists cloud games (signed in, paginated) above an on-device section,
with result badge, opponent, date, and move count; rows push the
replay GameView. Reachable from Home.
EOF
)"
```

---

### Task 16: Validation matrix + verify-site smoke check

**Files:** modify `scripts/verify-site.sh`.

- [ ] **Step 1: Extend the accounts block** in `scripts/verify-site.sh` — inside the existing `if [[ -n "${ACCOUNTS_API_URL:-}" ]]` block, after the `/v1/me` check, add the same pattern for games:

```bash
  code="$("$CURL" -s -o /dev/null -w "%{http_code}" "${ACCOUNTS_API_URL%/}/v1/games" || echo "000")"
  if [[ "$code" == "401" ]]; then
    echo "OK   accounts api (unauthenticated /v1/games -> 401)"
  else
    echo "FAIL accounts api games (expected 401, got $code)"; FAIL=1
  fi
```

(Use the script's actual `FAIL` variable — it is `FAIL`, not `FAILED`.)

- [ ] **Step 2: Full validation matrix** — run every row; all must hold:

| Check | Command | Expect |
|---|---|---|
| Accounts tests | `(cd server/accounts && npm test)` | all pass (87 baseline + new) |
| Accounts types/build | `(cd server/accounts && npm run typecheck && npm run build)` | clean, `dist/index.js` |
| Multiplayer tests | `(cd server/multiplayer && npm test)` | all pass (16 baseline + new) |
| Multiplayer types/build | `(cd server/multiplayer && npm run typecheck && npm run build)` | clean |
| Web tests | `(cd web && npm test)` | all pass (69 baseline + new) |
| Web types | `(cd web && npx tsc --noEmit)` | clean |
| Web prod build | `(cd web && npm run build)` | succeeds |
| iOS sim build | `(cd ChessBorder && xcodebuild -project ChessBorder.xcodeproj -scheme ChessBorder -destination 'generic/platform=iOS Simulator' build \| tail -3)` | BUILD SUCCEEDED |
| Mac tests | `(cd ChessBorder && xcodebuild -project ChessBorder.xcodeproj -scheme ChessBorderMac test \| tail -3)` | exactly ONE failure: pre-existing OnlineTests border-move |
| Accounts CFN | `AWS_PROFILE=sahasralabs aws cloudformation validate-template --template-body file://server/aws/accounts.yaml --region us-east-1` | valid |
| Multiplayer CFN | `AWS_PROFILE=sahasralabs aws cloudformation validate-template --template-body file://server/aws/multiplayer.yaml --region us-east-1` | valid, SessionJwtSecret NoEcho |
| Deploy scripts parse | `bash -n server/aws/deploy-multiplayer.sh && bash -n scripts/verify-site.sh` | silent |

Manual web smoke (dev server): guest finishes a bot game → appears in Past Games; reload → no duplicate; replay opens read-only and does not overwrite the resume slot; signed-out online game finishes → appears under "On this device".

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-site.sh
git commit -m "$(cat <<'EOF'
Smoke-check the games API in verify-site

Unauthenticated GET /v1/games must 401, alongside the existing /v1/me
check in the ACCOUNTS_API_URL-gated block.
EOF
)"
```

- [ ] **Step 4: Deploy notes (do NOT deploy in this plan).** Order matters on first rollout:
1. `AWS_PROFILE=sahasralabs ./server/aws/deploy-accounts.sh` — new routes + Query IAM (secret already in SSM).
2. `AWS_PROFILE=sahasralabs ./server/aws/deploy-multiplayer.sh` — picks up the SSM secret, users-table IAM, env vars.
3. Web: rebuild + `./web/scripts/sync-s3-static.sh` (no new env vars needed — games ride on `VITE_ACCOUNTS_API_URL`).
4. `ACCOUNTS_API_URL=... ./scripts/verify-site.sh` — both 401 checks green.
5. iOS ships with the next app version bump (`project.yml`).

---

## Self-Review

- [x] **Spec coverage (Phase 3):** local rolling history (25, both platforms, guests) ✓; cloud `POST /v1/games` with retry queue ✓; online games recorded server-side with JWT-attributed seats ✓; `USER#/GAME#<endedAtISO>#<gameId>` storage, newest-first paginated `GET /v1/games` + `GET /v1/games/{id}` ✓; Past Games screen + replay viewer reusing the existing board/stepping (Phase 5 dependency) ✓. Conscious narrowing: result badge instead of final-position thumbnails (flagged, restorable). Stats counters added now for Phase 4.
- [x] **Guiding constraints honored:** guests' experience unchanged (history is additive; all cloud paths gate on session/config); every cloud failure degrades (upload queues, list falls back to local, invalid WS session ⇒ guest seat, recording failure never breaks a move); no client holds a backend secret (session JWT is the user's own credential; the multiplayer Lambda gets the signing secret server-side via SSM→CFN, same posture as the engine API_KEY).
- [x] **Exactly-once analysis:** live path flag + content dedupe (web and iOS identical); server side records only on the not-finished→finished transition, so rematches record per game and reconnects/replays never re-record; `POST /v1/games` rejecting `mode:"online"` prevents client/server double-writes. Accepted edges flagged: identical-game dedupe false negative, merged-view duplicates (no dedupe), self-play single item + double stats.
- [x] **Type consistency:** `GameRecord` (accounts protocol) ≡ `CompletedGameRecord` (web `gameHistory.ts`) ≡ `CompletedGameRecord` (iOS) ≡ `OnlineGameRecord` (multiplayer record.ts, mode pinned to "online") — same nine fields, same names, nullable in the same places; SK format `GAME#<endedAtISO>#<gameId>` identical in both writers; stats keys (`bot_<d>_<w|l|d>`, `online_<w|l|d>`) identical in `statsKeyFor` and `recordFinishedGame`; route keys in CFN match `handleRequest` switches and both clients' paths; storage keys match across platforms.
- [x] **IAM/infra gaps closed explicitly:** accounts role gains `dynamodb:Query` (was GetItem/PutItem/UpdateItem only); multiplayer role gains PutItem/UpdateItem on the users-table ARN built by name (cross-stack); `WsEvent`/`HttpEvent` extended for query/path params; deploy-multiplayer guards the SSM `None`/missing pitfall like the engine API_KEY.
- [x] **Replay safety:** replay mode disables persistence on both platforms (cannot clobber the resume slot), always runs the controller in `localTwoPlayer` so no bot can trigger, and skips history/upload hooks.
- [x] **Pattern fidelity:** TDD where logic exists (history store, validation, pagination, recording, queue, transition hooks); DOM/SwiftUI chrome untested per existing policy; esbuild/`tsx`/CFN/deploy-script changes mirror the multiplayer/accounts precedents; xcodegen gotchas restated at the step they bite; commits are HEREDOC, imperative, no co-author trailer.
