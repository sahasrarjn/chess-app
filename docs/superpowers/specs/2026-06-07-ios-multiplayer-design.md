# iOS Multiplayer — design

Status: approved 2026-06-07. Adds online play to the iOS/Mac app, fully
interoperable with web players. Backend unchanged.

## Goal

iOS players join the same share-a-link rooms as web players (iOS↔web, iOS↔iOS,
web↔web). Same low-friction guest model. Full parity with web: reconnect,
rematch, spectators, move list + history preview.

## Why no backend changes

The AWS API Gateway WebSocket + Lambda + DynamoDB room server is client-agnostic.
iOS connects to the same `wss://…/prod`, sends the same JSON messages, and the
server validates every move with the shared rules engine. iOS `Move.uci` uses
standard a–h/1–8 notation (engine 10×10 for border squares); the server's
`resolveUciInterpretations` accepts both, so iOS and web moves interoperate.

## New iOS components

- **`Online/OnlineProtocol.swift`** — `Codable` types mirroring the protocol:
  - Client → server: `join {roomId, token, name}`, `move {uci}`, `rematch`.
  - Server → client: `state {roomId, role, color, players{white,black}, moves,
    status, result, yourTurn, rematchOfferedBy}`, `error {message}`.
  - `result` decoded as `{type, winner?, reason?}` and mapped to display text.
- **`Online/OnlineSocket.swift`** — `URLSessionWebSocketTask` wrapper: connect,
  send(Encodable), receive loop, auto-reconnect with backoff, status callback,
  `onOpen` (caller resends `join`).
- **`Online/OnlineIdentity.swift`** — guest token (`bc_player_token`) + name
  (`bc_guest_name`) in `UserDefaults`; `newRoomCode()` (6-char base36).
- **`Online/MultiplayerConfig.swift`** — `wss` URL from `Info.plist`
  (`MultiplayerServerURL`).
- **`ViewModels/OnlineGameViewModel.swift`** — `@MainActor ObservableObject`,
  conforms to `BoardModel`. Holds server `state`; rebuilds a `ChessGame` from
  `moves` using `game.move(from: uci)`; **optimistic** local move (reconciled by
  the server echo, reverted on `error`); history preview (`previewPly` +
  snapshot); reconnect (resend join on socket reopen); rematch; spectator;
  emits move sounds via `ChessSound`.
- **`Views/OnlineGameView.swift`** — SwiftUI screen mirroring `GameView`:
  header (Leave / "Online" / opponent name / mute), a lobby card with the
  **room code + `ShareLink`** (web URL) while waiting, status pill, the shared
  board, `MoveListView`, history controls (◀ ▶ Live) via `GameToolStrip`,
  rematch offer/accept, spectator badge, connection-status line.

## Reuse

- **Generic board:** introduce `protocol BoardModel: ObservableObject` capturing
  the read surface `SquareView`/`BoardView` need (`boardFlipped`, `piece(at:)`,
  `isSelected`, `isLegalTarget`, `isCaptureTarget`, `isLastMoveSquare`,
  `isKingInCheck`, `isHintSquare`, `squareBackgroundColor`, `handleSquareTap`,
  `activeMoveAnimation`, `isAnimatingMove(from:)/(to:)`). Make `SquareView` and
  `BoardView` generic over `BoardModel`. `GameViewModel` already implements all
  of it (declare conformance); `OnlineGameViewModel` implements it too
  (`activeMoveAnimation` = nil, no piece-fly animation online).
- Reuse `MoveListView`, `GameChrome` components, `ChessSound`, `ChessGame`,
  `Square`/`Move`/`Piece`, `BoardTheme`.

## Home screen

`HomeView` gains an online section: **Play Online** (create a room → push
`OnlineGameView`) and **Join with code** (text field accepting a 6–12 char code
or a pasted `…?room=<code>` URL, from which the code is extracted).

## Cross-platform link

Share link is always the website: `https://borderchess.org/play/?room=<code>`.
A recipient without the app opens it on the web; with the app they can paste the
link/code into "Join with code" (Universal Links deferred). Room ids are opaque
to the server, so iOS 6-char codes and web 12-char ids both work.

## Config / deploy

- Add `MultiplayerServerURL` = `wss://…/prod` to iOS `Info.plist` (same value as
  web's `VITE_MULTIPLAYER_WS_URL`).
- New `.swift` files are registered in `project.pbxproj` for both the
  `ChessBorder` (iOS) and `ChessBorderMac` targets.
- iOS cannot be deployed from here; verification is simulator build + tests; the
  owner does the Xcode/TestFlight build.

## Testing

- `OnlineProtocol` Codable round-trips (encode client msgs, decode a `state`).
- `OnlineGameViewModel` against a fake socket: seat/role from state, optimistic
  move sends UCI + blocks until echo, server echo reconciles, illegal `error`
  reverts, history preview, reconnect resends join.
- Build `ChessBorder` (iOS sim) and `ChessBorderMac`; run `BotEvalTests`.

## Out of scope (v1)

Universal Links / deep-link app opening, in-app chat, time controls.
