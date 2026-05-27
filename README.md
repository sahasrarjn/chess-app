# Chess Border

An iPhone chess app with a **chess.com-inspired UI** and a **10×10 board**: standard FIDE chess on an inner 8×8, surrounded by **one empty square on every side** (top, bottom, left, and right). Pieces start in the same relative positions as normal chess, but kings, queens, and edge pawns can use the border for extra room.

## Features (v1)

- **Play vs Bot** — Easy / Medium / Hard via **Fairy-Stockfish** (GPL v3) on Mac; built-in minimax fallback on iOS until in-process engine ships
- **Play with Friend** — pass-and-play on one iPhone, board auto-flips each turn
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

| Platform | Bot engine |
|----------|------------|
| **Mac app** | Fairy-Stockfish (full strength, fast) |
| **iOS Simulator** (on Mac) | Fairy-Stockfish via bundled subprocess |
| **Physical iPhone** | Built-in minimax fallback (v0) |

**Can Fairy-Stockfish run locally on a real iPhone?** Not with the current subprocess approach. iOS does not allow spawning a separate engine binary from the app bundle the way macOS does — even if we cross-compiled an `iphoneos` binary. The reliable path for a future v1 is to **link Fairy-Stockfish in-process** as a static library (how most iOS chess apps ship Stockfish). For v0, play vs bot on a physical iPhone uses the built-in minimax; Mac and Simulator get Fairy-Stockfish.

If the iOS simulator runtime is missing, install it via **Xcode → Settings → Components**.

## Project structure

```
ChessBorder/
├── ChessBorder/
│   ├── Engine/          # 10×10 rules, move generation, validation
│   ├── Bot/             # Fairy-Stockfish (Mac) + minimax fallback
│   ├── ViewModels/
│   ├── Views/           # SwiftUI UI
│   ├── Models/
│   ├── Theme/
│   └── Assets.xcassets/ # Cburnett piece SVGs
├── project.yml
└── ChessBorder.xcodeproj
```

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE). Chess piece SVGs: [Cburnett on Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces).
