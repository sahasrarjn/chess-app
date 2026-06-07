# Multiplayer (share-a-link online play) — design

Status: approved 2026-06-07. Web-first. Server-authoritative. Backend on AWS.

## Goal

Two friends play Border Chess over the internet with minimal friction: one taps
"Play online", shares a link, the other opens it, and they play in real time.
No accounts — guest usernames only. v1 includes reconnect, rematch, and
spectators. In-game chat is deferred.

## Architecture

```
Browser A ─┐                                  ┌─ DynamoDB (rooms + connections)
           ├─ wss:// ─ API Gateway (WS API) ─ Lambda (room logic + rules engine)
Browser B ─┘                                  └─ broadcast via API GW mgmt API
```

- New AWS stack `chess-border-multiplayer` (CFN `server/aws/multiplayer.yaml`):
  API Gateway **WebSocket API** → one **Lambda** → **DynamoDB** table. Separate
  from the engine/static stacks; the existing engine, worker, and CloudFront are
  untouched.
- The browser connects **directly** to the WebSocket API (not through
  CloudFront). The web app receives the URL via build var
  `VITE_MULTIPLAYER_WS_URL`.
  - Target: custom domain `ws.borderchess.org` (API GW custom domain + ACM cert
    + grey-cloud Cloudflare CNAME).
  - Pragmatic first deploy: the API Gateway `execute-api` `wss://` URL, to avoid
    an unattended ACM/DNS dance. Custom domain is a fast-follow; only the build
    var changes.

## Shared rules engine

The current self-contained engine (`web/src/engine/`: `chessGame.ts`, `fen.ts`,
`types.ts`, `uci.ts`, `moveNotation.ts`) moves to **`shared/engine/`**, imported
by both the web app and the Lambda (Lambda bundles it with esbuild). Internal
relative imports are unaffected; only the web app's import paths change
(mechanical, covered by the existing engine tests). Reused server-side:
`new ChessGame()`, `legalMoves()`, `applyMove()`, `result`, `copy()`, and
`matchEngineMove(game, uci)` / `moveUci(move)` for UCI ↔ legal-move mapping.

## Identity & link model (no accounts)

- First visit: client generates a **guest name** ("Brave Knight 4271", editable)
  and a random **player token** (UUID); both persist in `localStorage`. The
  token is the invisible seat credential — it is never displayed and enables
  reconnect.
- "Play online" creates a room: random unguessable `roomId` (base62, ~10 chars).
  Creator becomes **White**. UI shows "Share this link — waiting for opponent…"
  with copy button. Link: `https://borderchess.org/play/?room=<roomId>`.
- Opening the link joins as **Black** (second distinct token). The game starts
  when Black is present. Further visitors become **spectators** (receive state,
  cannot move).

## AWS components & data model

DynamoDB single table `chess-border-multiplayer`, on-demand billing, TTL enabled.

- **Room item** — `PK = ROOM#<roomId>`, `SK = META`
  - `moves`: string[] of UCI (authoritative move list)
  - `status`: `waiting | active | finished`
  - `white`, `black`: `{ token, name, connId|null, connected: bool }`
  - `spectators`: `[{ connId }]`
  - `rematch`: `{ offeredBy: "white"|"black"|null }`
  - `createdAt`, `updatedAt`, `ttl` (epoch secs, ~24h after last activity)
- **Connection item** — `PK = CONN#<connectionId>`, `SK = META`
  - `roomId`, `role` (`white|black|spectator`) — used by `$disconnect`.
- Broadcasting iterates the room's known connIds (white, black, spectators). No
  GSI required.

Lambda routes: `$connect`, `$disconnect`, `$default`, and message `type`s
`join`, `move`, `rematch`.

## Server-authoritative rules

On each `move` the Lambda loads the room, replays `moves[]` through the shared
engine to reconstruct the position, then:
1. Verifies the sender owns the side to move (token matches `white`/`black`,
   correct color, not a spectator), game `active`.
2. `matchEngineMove(game, uci)` → if null/illegal, send `error` to sender only.
3. Else append UCI, recompute `result`/`status`, persist, broadcast `state` to
   all connections.

This makes desync and client tampering impossible; clients render confirmed
state. Clients may still compute local legality for instant UI feedback, but the
server `state` is authoritative.

## Message protocol

Client → server (JSON, `type` field):
- `join  { roomId, token, name }`
- `move  { uci }`
- `rematch { accept?: boolean }`  (first send = offer; `accept:true` = accept)

Server → client:
- `state { roomId, role, color, players:{white,black}, moves, status, result, yourTurn }`
- `error { message }`
- `opponent { event: "joined" | "left" }`
- `rematch { offeredBy }`

## Flows

- **Create / host:** generate roomId + token, open socket, send `join`. No room →
  create, seat White, `status=waiting`, return `state`.
- **Join:** open link → `join` with own token. Empty Black seat & new token →
  seat Black, `status=active`, broadcast `state` + `opponent:joined`. Seats full
  & unknown token → spectator.
- **Move:** as above; broadcast new `state`.
- **Reconnect:** refresh reopens socket and re-sends `join` with the same token;
  server matches token to its seat, updates `connId`, marks connected, replays
  `state`. Spectators reattach as spectators.
- **Disconnect:** `$disconnect` looks up the connection item, clears that
  connId, marks the player disconnected, broadcasts `opponent:left`; the room
  persists (TTL) so the player can rejoin.
- **Rematch:** at `finished`, a seated player sends `rematch` (offer); opponent
  sees `rematch{offeredBy}`; on `rematch{accept:true}` the room resets
  `moves=[]`, swaps White/Black seats, `status=active`, broadcasts `state`.

## Web client

- `web/src/online/` — `wsClient.ts` (typed socket: connect, send, reconnect with
  backoff, message events) and `MultiplayerController.ts` (peer to
  `GameController`: holds server state, exposes the same surface `BoardView`
  needs — `piece`, `legalTargets`, `selectedSquare`, `handleSquareTap`,
  `boardFlipped`, etc. — but sends `move` to the server and applies confirmed
  `state`).
- `web/src/online/guestIdentity.ts` — token + guest-name generation/persistence.
- Home: "Play online" entry → creates room and navigates to the game screen in
  online mode.
- Game screen (online): lobby/share panel while `waiting`; opponent name in
  header; spectator badge for spectators; rematch offer/accept UI at game end;
  connection-status line ("Opponent disconnected — waiting to reconnect…").
- Board orientation: White at bottom for White, flipped for Black, default for
  spectators. Hint button is hidden in online mode (out of scope); existing
  sound/flip remain.

## Security / abuse

- `roomId` unguessable; token never displayed; all moves validated server-side
  (out-of-turn / wrong-color / spectator / illegal all rejected).
- Per-connection guards: max message size, simple rate limit.
- DynamoDB TTL garbage-collects abandoned rooms (~24h).

## Testing

- **Engine:** existing tests move with the engine and stay green.
- **Lambda room logic** (unit, fake store): seat assignment (1st White, 2nd
  Black, 3rd spectator), reconnect-by-token restores seat, illegal /
  out-of-turn / spectator-move rejection, result detection, rematch swap+reset,
  disconnect handling.
- **Protocol:** message parse/validation tests.
- **Web:** `MultiplayerController` transitions against a fake socket (join →
  waiting → active → move echo → finished → rematch).

## Build order (all v1)

1. Extract shared engine; all tests green.
2. AWS stack (CFN) + Lambda core ($connect/$disconnect/join/move/state) +
   DynamoDB store — 1v1 server-authoritative.
3. Web online mode: WS client, MultiplayerController, lobby/share, board wiring.
4. Reconnect + spectators + rematch.
5. Deploy multiplayer stack, wire `VITE_MULTIPLAYER_WS_URL`, deploy web, verify.

## Out of scope (v1)

In-game chat/emotes, time controls/clocks, matchmaking with strangers, ranked
play, iOS client (web links still open in mobile browsers).
