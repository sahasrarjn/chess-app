# Chess Border

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
| **Chess pieces (Cburnett)** | [Lichess / lila](https://github.com/lichess-org/lila/tree/master/public/piece/cburnett) | CC BY-SA 3.0 / GPL | Bundled as SVG in `Assets.xcassets` |
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

**Mac App Store:** possible but legally debated (Apple DRM vs GPL). Direct download is simpler for GPL compliance.

## Requirements

- Xcode 16+ (command-line tools are enough to build)
- **Mac (Apple Silicon):** macOS 14+ — native Mac app via `ChessBorderMac`
- **iPhone:** iOS 17+ (portrait)

## Run without opening Xcode (recommended on Mac)

From the repo:

```bash
cd ChessBorder
./run.sh        # default: build + launch native Mac app
./run.sh sim    # iOS Simulator (iPhone 17)
./run.sh ios    # build .app for a physical iPhone (install via Xcode Devices)
```

Native Mac build output:

`ChessBorder/build/DerivedData/Build/Products/Debug/Chess Border.app`

You can also launch it directly:

```bash
open "ChessBorder/build/DerivedData/Build/Products/Debug/Chess Border.app"
```

After editing `project.yml`, regenerate the Xcode project:

```bash
cd ChessBorder && xcodegen generate
```

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

In the app home screen, set **Engine server** to your HTTPS URL (or `http://LAN_IP:8080` on the same Wi‑Fi for dev). Details: [server/README.md](server/README.md).

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

GNU General Public License v3.0 — see [LICENSE](LICENSE). Chess piece SVGs: [Cburnett on Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces).
