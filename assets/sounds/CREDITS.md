# Sound effect credits & licensing

All sound files in this directory are **original works**, synthesized
procedurally by `generate_sounds.py` (Python standard library only) and
encoded with ffmpeg via `build_mp3.sh`. They contain no audio data sampled
from any third party.

## License — CC0 1.0 (Public Domain Dedication)

To the extent possible under law, the Border Chess project has waived all
copyright and related rights to these sound files. They are dedicated to the
**public domain (CC0 1.0)** and are free to use for any purpose, including
commercially, with **no attribution required**.

<https://creativecommons.org/publicdomain/zero/1.0/>

This is compatible with the project's GPLv3 license.

## Files

| File            | Event it plays for                                   |
|-----------------|------------------------------------------------------|
| `move.mp3`      | A normal (non-capturing) move                        |
| `capture.mp3`   | A capture (including en passant)                     |
| `check.mp3`     | A move that gives check                              |
| `castle.mp3`    | Castling                                             |
| `promote.mp3`   | A pawn promotion                                     |
| `game-start.mp3`| A new game begins / a saved game is loaded           |
| `game-end.mp3`  | Checkmate, stalemate, draw, or resignation           |
| `illegal.mp3`   | An attempted illegal / rejected move                 |

## Regenerating

```bash
./build_mp3.sh   # synthesizes WAVs, encodes MP3s, cleans up
```

The generator is seeded (`random.seed(1729)`), so rebuilds are deterministic.

## Distribution

`assets/sounds/` is the **source of truth**. Copies live at:

- **Web:** `web/public/sounds/*.mp3` (served as static assets)
- **iOS/Mac:** `ChessBorder/ChessBorder/Assets.xcassets/Sounds/*.dataset`
  (loaded at runtime via `NSDataAsset`)

Run `./sync.sh` after regenerating to refresh both copies.
