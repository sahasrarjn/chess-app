# Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Share-a-link real-time online Border Chess for two friends, server-authoritative, with reconnect, rematch, and spectators.

**Architecture:** AWS API Gateway WebSocket API → one Lambda (room logic + shared rules engine) → DynamoDB. Browser connects directly over `wss://`. Engine extracted to `shared/engine/` and imported by web + Lambda.

**Tech Stack:** TypeScript, esbuild (Lambda bundle), AWS CloudFormation, DynamoDB, API Gateway WebSocket, Vite (web), `node --test`.

Spec: `docs/superpowers/specs/2026-06-07-multiplayer-design.md`

---

## Phase 1 — Extract shared engine

### Task 1: Move engine to shared/engine

**Files:**
- Move: `web/src/engine/*.ts` → `shared/engine/*.ts` (incl. tests)
- Modify: every web import of `../engine/...` / `./engine/...`
- Modify: `web/tsconfig.json` (allow importing from `../shared`), `web/package.json` test glob if needed

- [ ] Move files with `git mv`, keeping internal relative imports intact.
- [ ] Update web imports to point at the new location (path alias `@engine` or relative `../../shared/engine`).
- [ ] Run web build + tests; all green.
- [ ] Commit.

## Phase 2 — Lambda + room logic (pure, fake store)

### Task 2: Room state machine (pure functions)

**Files:**
- Create: `server/multiplayer/src/room.ts` — `RoomState` type + pure transitions: `joinRoom`, `applyMove`, `offerRematch`, `acceptRematch`, `disconnect`, `reconnect`, `seatFor(token)`.
- Test: `server/multiplayer/src/room.test.ts`

Transitions operate on a plain `RoomState` object and return `{ state, broadcasts }`. No AWS/DynamoDB here. Move validation via `matchEngineMove` from `shared/engine`.

- [ ] Tests: 1st join→White/waiting; 2nd→Black/active; 3rd→spectator; reconnect by token restores seat; illegal move rejected (sender error); out-of-turn rejected; spectator move rejected; checkmate→finished; rematch offer then accept swaps colors + resets.
- [ ] Implement to pass. Commit.

### Task 3: DynamoDB store

**Files:**
- Create: `server/multiplayer/src/store.ts` — `RoomStore` interface + `DynamoRoomStore` (get/put room, put/del/get connection). `InMemoryRoomStore` for tests.
- Test: `server/multiplayer/src/store.test.ts` (InMemory behavior)

- [ ] Define interface; implement in-memory + Dynamo (aws-sdk v3 `@aws-sdk/client-dynamodb` + `lib-dynamodb`).
- [ ] Commit.

### Task 4: Lambda handler

**Files:**
- Create: `server/multiplayer/src/handler.ts` — routes `$connect`/`$disconnect`/`$default`; parse `type`; call room transitions; persist; broadcast via `@aws-sdk/client-apigatewaymanagementapi`.
- Create: `server/multiplayer/package.json`, `tsconfig.json`, esbuild bundle script.
- Test: `server/multiplayer/src/handler.test.ts` (fake store + fake broadcaster; assert messages per route)

- [ ] Tests for join/move/rematch/disconnect routing using InMemoryRoomStore + capturing broadcaster.
- [ ] Implement; `npm run build` produces `dist/handler.js`. Commit.

## Phase 3 — AWS stack

### Task 5: CloudFormation + deploy script

**Files:**
- Create: `server/aws/multiplayer.yaml` — DynamoDB table (PK/SK, TTL `ttl`, on-demand), Lambda (Node 20, env `TABLE_NAME`, `WS_ENDPOINT`), IAM role (DynamoDB CRUD + `execute-api:ManageConnections`), WebSocket API + `$connect/$disconnect/$default` routes + integration + stage `prod`, permissions.
- Create: `server/aws/deploy-multiplayer.sh` — build Lambda bundle, package, `aws cloudformation deploy`, output the `wss://` URL. Uses `AWS_PROFILE`/region conventions from existing scripts.

- [ ] Author template + script. `bash server/aws/deploy-multiplayer.sh` (later, in deploy phase).
- [ ] Commit.

## Phase 4 — Web online client + UI

### Task 6: Guest identity

**Files:**
- Create: `web/src/online/guestIdentity.ts` — `getPlayerToken()` (uuid in localStorage), `getGuestName()/setGuestName()` (random adjective+noun+digits).
- Test: `web/src/online/guestIdentity.test.ts`

- [ ] Stable token across calls; name generation shape. Commit.

### Task 7: WS client

**Files:**
- Create: `web/src/online/wsClient.ts` — typed connect/send/close, auto-reconnect with backoff, `onMessage`/`onStatus` callbacks; message types mirror spec.
- Test: `web/src/online/wsClient.test.ts` (fake WebSocket)

- [ ] Reconnect + message dispatch tests. Commit.

### Task 8: MultiplayerController

**Files:**
- Create: `web/src/online/multiplayerController.ts` — holds server `state`; exposes the read surface `BoardView`/render needs; `handleSquareTap` selects then sends `move {uci}`; applies confirmed `state`; `offerRematch/acceptRematch`; status (waiting/active/finished/opponent-left).
- Test: `web/src/online/multiplayerController.test.ts` (fake wsClient)

- [ ] join→waiting→active→local-tap-sends-uci→state-echo-applies→finished→rematch. Commit.

### Task 9: Online UI wiring

**Files:**
- Modify: `web/src/ui/home.ts` — add "Play online" button → create room, navigate.
- Modify: `web/src/main.ts` (router) — read `?room=`, mount online game view; route to online mode.
- Create: `web/src/ui/onlineGameView.ts` (or extend `gameView.ts`) — reuse board rendering; lobby/share panel while waiting; opponent name; spectator badge; rematch offer/accept; connection-status line.
- Modify: `web/src/styles.css` — lobby/share + badge styles.

- [ ] Build green. Manual-equivalent: controller tests cover logic. Commit.

## Phase 5 — Deploy + verify

### Task 10: Deploy stack, wire URL, deploy web

- [ ] `AWS_PROFILE=sahasralabs bash server/aws/deploy-multiplayer.sh` → capture `wss://` URL.
- [ ] Set `VITE_MULTIPLAYER_WS_URL` for the web build (deploy script env or `.env`).
- [ ] `AWS_PROFILE=sahasralabs ./web/scripts/sync-s3-static.sh`.
- [ ] Smoke test: open two browser sessions, create + join via link, play moves, refresh to reconnect, rematch, third tab spectates.
- [ ] Commit any deploy-config changes.

---

## Self-review notes
- Spec coverage: identity (T6), link/seat model (T2,T9), server-authoritative validation (T2), data model/store (T3), protocol/handler (T4), AWS infra (T5), reconnect/rematch/spectators (T2,T8,T9), deploy (T10). Engine sharing (T1).
- Risk: API Gateway custom domain deferred → first deploy uses execute-api URL (build var only).
- Risk: web import churn in T1 — mitigated by full engine test suite.
