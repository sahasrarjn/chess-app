# Border Chess

An iPhone chess app with a **chess.com-inspired UI** and a **10×10 board**: standard FIDE chess on an inner 8×8, surrounded by **one empty square on every side** (top, bottom, left, and right). Pieces start in the same relative positions as normal chess, but kings, queens, and edge pawns can use the border for extra room.

## Features (v1)

- **Play vs Bot** — Fairy-Stockfish locally on Mac/Simulator; **remote engine server** on physical iPhone (see `server/`)
- **Play with Friend** — pass-and-play on one iPhone, board auto-flips each turn
- **Web** — same modes in the browser (`web/`), no online multiplayer
- Standard FIDE rules: castling, en passant, promotion, check/checkmate/stalemate, 50-move rule
- Legal move dots, last-move highlight, check highlight, pawn promotion picker
- No online multiplayer (by design for v1)

## Board layout

```
   a  b  c  d  e  f  g  h  i  j
10 ·  ·  ·  ·  ·  ·  ·  ·  ·  ·   ← border
 9 ♜  ♞  ♝  ♛  ♚  ♝  ♞  ♜
 8 ♟  ♟  ♟  ♟  ♟  ♟  ♟  ♟
 7 ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
   …
 3 ♙  ♙  ♙  ♙  ♙  ♙  ♙  ♙
 2 ♖  ♘  ♗  ♕  ♔  ♗  ♘  ♖
 1 ·  ·  ·  ·  ·  ·  ·  ·  ·  ·   ← border
     ↑                          ↑
   border                     border
```

Playable squares: files **b–i**, ranks **2–9** (1-indexed from White’s perspective).

## Open source used

| Component | Source | License | Notes |
|-----------|--------|---------|-------|
| **Bot engine** | [Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish) | GPL v3 | Stockfish derivative; 10×10 via `variants.ini` |
| **Chess pieces (Maestro)** | [Lichess / lila](https://github.com/lichess-org/lila/tree/master/public/piece/maestro) | See Lichess licensing | Bundled as SVG in `Assets.xcassets` |
| **UI inspiration** | [ChessboardKit](https://github.com/rohanrhu/ChessboardKit) (MIT) | MIT | Patterns referenced; board is custom 10×10 |
| **Project scaffolding** | [XcodeGen](https://github.com/yonaskolb/XcodeGen) | MIT | `project.yml` → `.xcodeproj` |

Standard **Stockfish** is 8×8 only. This app uses **Fairy-Stockfish** so the bot understands the 10×10 border board.

### Bot engine setup (Mac)

```bash
./ChessBorder/scripts/setup-engine.sh   # clones & builds fairy-stockfish into Resources/Engine/
cd ChessBorder && ./run.sh mac
```

Without the binary, the Mac app falls back to the built-in minimax bot.

## License & commercial use

**This project is GPL v3** because it bundles Fairy-Stockfish (GPL v3). See [LICENSE](LICENSE).

You **may sell the app commercially** (website, Gumroad, etc.) under GPL v3. You must:

- Keep the app open source (same GPL license)
- Provide **full source code** to users who get the binary (e.g. public GitHub repo + link in the app)
- Include GPL license text and engine attribution ([THIRD_PARTY.md](THIRD_PARTY.md))

Many GPL apps charge money — users pay for convenience, support, and builds, not for proprietary code.

**Mac App Store:** possible but legally debated (Apple DRM vs GPL). Provide a public source link in the listing and app; see [ChessBorder/scripts/README.md](ChessBorder/scripts/README.md). Direct download (`release-mac.sh`) remains simpler for GPL compliance.

## Public distribution

- **Web:** [chess-engine.sahasraranjan.workers.dev/play/](https://chess-engine.sahasraranjan.workers.dev/play/)
- **iPhone:** OTA install from [chess-engine.sahasraranjan.workers.dev](https://chess-engine.sahasraranjan.workers.dev)
- **Mac (App Store):** `./ChessBorder/scripts/release-appstore-mac.sh` — full workflow in [ChessBorder/scripts/README.md](ChessBorder/scripts/README.md)
- **Mac (direct download):** `./ChessBorder/scripts/release-mac.sh` — Developer ID DMG + notarization

## Requirements

- Xcode 16+ · iOS 17+ (iPhone) · macOS 14+ (Mac app + dev builds)

## Local development

```bash
cd ChessBorder
./run.sh sim    # iOS Simulator
./run.sh mac    # Mac app (dev only)
./run.sh ios    # build for physical iPhone
```

Regenerate Xcode project after editing `project.yml`: `xcodegen generate` (from `ChessBorder/`).

## Run on your iPhone

1. Connect your iPhone via USB and trust the Mac.
2. Open `ChessBorder/ChessBorder.xcodeproj` in Xcode.
3. Select the **ChessBorder** scheme (not ChessBorderMac).
4. Select your **Apple Developer team** under Signing & Capabilities (team is preconfigured in `project.yml` as `K89NSAWKXN`).
5. Choose your iPhone as the run destination.
6. Press **Run** (⌘R).

Or from the command line (requires a registered device on your Apple Developer account):

```bash
cd ChessBorder && ./run.sh ios
```

### Bot on iPhone vs Mac

| Platform | Engine |
|----------|--------|
| **Mac app** | Fairy-Stockfish (local) |
| **iOS Simulator** | Fairy-Stockfish (local) |
| **Physical iPhone** | **Your server** (`server/`) — no minimax |

Local Stockfish on a real iPhone is not viable via subprocess (iOS sandbox). The app calls your deployed Fairy-Stockfish HTTP API instead.

**Deploy the engine server:**

```bash
docker compose -f server/docker-compose.yml up --build
```

Engine URL and API key are set in `ChessBorder/Info.plist` (`EngineServerURL`, `EngineServerAPIKey`). Details: [server/README.md](server/README.md).

If the iOS simulator runtime is missing, install it via **Xcode → Settings → Components**.

## Web (browser)

```bash
docker compose -f server/docker-compose.yml up --build   # engine for bot
cd web && npm install && npm run dev
```

Open http://localhost:5173/play/ — see [web/README.md](web/README.md).

## Project structure

```
chess-app/
├── ChessBorder/
│   ├── ChessBorder/
│   │   ├── Engine/
│   │   ├── Bot/             # Local + remote Fairy-Stockfish
│   │   └── Views/
│   ├── project.yml
│   └── ChessBorder.xcodeproj
├── web/                     # Browser client (Vite + TypeScript)
└── server/                  # Dockerized Fairy-Stockfish API for iPhone + web bot
```

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE). Source: [github.com/sahasrarjn/chess-app](https://github.com/sahasrarjn/chess-app). Chess piece SVGs: [Lichess Maestro](https://github.com/lichess-org/lila/tree/master/public/piece/maestro).
