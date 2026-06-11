# Border Chess — Production Features Design

**Date:** 2026-06-11
**Status:** Approved
**Scope:** Board color themes, Google/Apple sign-in, past games, leaderboard, AI coach — web and iOS together, phased.

## Decisions (settled with user)

- **Platforms:** Web + iOS in lockstep — each phase ships on both before the next begins.
- **Coach:** Engine-only (no LLM). Live coaching + post-game review.
- **Leaderboard:** Stats only (wins / games played / win rate). No Elo rating.
- **Auth:** Optional sign-in everywhere. Google + Apple providers from day one (App Store Guideline 4.8 requires Apple sign-in alongside Google on iOS).
- **Backend:** Extend the existing AWS stack — new HTTP API Gateway + TypeScript Lambda + DynamoDB, CloudFormation modeled on `server/aws/multiplayer.yaml`.

## Guiding constraints

- Guests keep today's exact experience. Sign-in unlocks cloud history, leaderboard placement, and profile — it never gates play.
- Every cloud feature degrades gracefully: auth API down → play as guest; history POST fails → queue locally and retry; analyze fails → local eval fallback. No new failure mode may block starting or finishing a game.
- Clients never hold backend secrets (existing convention: the Cloudflare Worker adds `X-API-Key`; same posture for new services).
- Minimize diff scope; follow existing patterns per package (vanilla TS controllers on web, SwiftUI + ViewModels on iOS, esbuild Lambda in `server/multiplayer`).

---

## Phase 1 — Board color themes

**Web**
- New `web/src/theme/boardThemes.ts`: registry of ~6 presets (Classic Green = current colors, Walnut, Ocean, Slate, Tournament Brown, High Contrast). Each preset defines the existing CSS variables: `--light-square`, `--dark-square`, plus highlight/hint tints where a palette needs them.
- Applying a theme sets the variables on `document.documentElement`; selection persists to `localStorage` (`chessborder.boardTheme`).
- UI: settings popover opened from a gear icon on the home screen and in-game header, showing tappable mini board swatches. The `.settings-panel` / `.settings-toggle` CSS stubs in `web/src/styles.css` are the starting point.

**iOS**
- `ChessBorder/Theme/BoardTheme.swift` becomes a registry of the same presets (identical hex values so platforms match).
- Selection persisted via `@AppStorage`; new Settings sheet reachable from `HomeView` and `GameView`.

**Out of scope:** cloud-synced preferences (revisit after Phase 2 if wanted).

---

## Phase 2 — Accounts (Google + Apple sign-in)

**Infrastructure** — new CloudFormation stack `server/aws/accounts.yaml`:
- HTTP API Gateway + one TypeScript Lambda (`server/accounts/`, esbuild, mirroring `server/multiplayer` layout).
- DynamoDB `UsersTable` (PAY_PER_REQUEST):
  - `USER#<userId>` / `META` — email, displayName (editable), avatarUrl, createdAt, stats counters (online W/L/D; bot W/L/D per difficulty).
  - `IDP#<provider>:<sub>` / `META` — provider identity → `userId` mapping.
- JWT signing secret in SSM Parameter Store (SecureString), same handling pattern as the engine `API_KEY`.

**Auth flow**
1. Client obtains an ID token natively: Google Identity Services (web), Google Sign-In SDK (iOS), Sign in with Apple (native `ASAuthorization` on iOS, Apple JS on web).
2. `POST /v1/auth/login` with the ID token. Lambda verifies signature + audience against Google/Apple JWKS (cached), then resolves the user:
   - existing `IDP#` mapping → that user;
   - else verified email matches an existing user → link new provider to it (safe: Google and Apple emails are verified);
   - else create a new user.
3. Response: backend-issued JWT (~30-day expiry) + profile. Web stores it in localStorage; iOS in Keychain.
4. `GET /v1/me` validates the session and returns profile + stats. `POST /v1/me` updates displayName.

**Client UI**
- Home screen: subtle "Sign in" affordance; signed-in state shows avatar/name with a sign-out option.
- Guest identity (`bc_player_token`, `bc_guest_name`) continues to work untouched.

---

## Phase 3 — Past games

**Local history (everyone, including guests)**
- The single `chessborder.savedGame` slot stays for resume; completed games additionally append to a rolling local history (last 25) under a new key, same snapshot schema. Web: localStorage (`web/src/game/savedGame.ts` grows a history module). iOS: `UserDefaults` via `SavedGameStore.swift`.

**Cloud history (signed-in)**
- Bot/local games: client `POST /v1/games` with the completed game (UCI moves, result, mode, difficulty, timestamps) under the session JWT. Failures queue locally and retry on next launch.
- Online games: the **multiplayer Lambda** records the game server-side at game end (authoritative — results can't be spoofed). The WebSocket connect carries an optional session JWT; verified `userId` is stored on the seat so the finished game is attributed to both players when signed in.
- Storage in `UsersTable`: `USER#<userId>` / `GAME#<endedAtISO>#<gameId>` — moves, result, mode, opponent (name or difficulty). Newest-first query, paginated. `GET /v1/games` lists; `GET /v1/games/<id>` fetches one.

**UI (web + iOS)**
- Past Games screen: rows with result badge, opponent/difficulty, date, and a mini thumbnail of the final position (rendered from the move list with the existing board model).
- Tapping opens a **replay viewer**: the existing board component plus first/prev/next/last controls stepping through the FEN history. Built here deliberately — Phase 5's post-game review reuses it.

---

## Phase 4 — Leaderboard

- Ranking metric: **online wins** (completed human-vs-human games only). Displayed: rank, name, avatar, wins, games, win rate. Bot stats appear on the user's own profile but never rank.
- When the multiplayer Lambda records an online game (Phase 3), it transactionally updates both players' stats counters and a `LEADERBOARD` GSI item (constant partition key, zero-padded wins + userId as sort key) — fine at this scale; revisit if it ever becomes a hot partition.
- `GET /v1/leaderboard` returns top 100 from the GSI, cacheable ~60s.
- UI: leaderboard screen on web + iOS, with the signed-in user's own row pinned if outside the top 100.

---

## Phase 5 — Coach (engine-only)

**Server**
- Extend the FastAPI engine (`server/`) with `POST /v1/analyze`: given FEN/moves and a movetime, returns score (centipawns or mate-in-N, from the mover's perspective) + best line (PV). The Cloudflare Worker proxies it exactly like `/v1/move`.
- Fallbacks mirror the bot chain: local Fairy-Stockfish on Mac/simulator; minimax `evaluate()` (`web/src/bot/chessBot.ts`) on web when the API is unreachable.

**Live coach** (opt-in toggle in settings, off by default)
- Eval bar beside the board, updated after each move.
- After each player move: compare eval before/after; classify by swing thresholds (inaccuracy / mistake / blunder). On mistake or worse, show a banner with a template explanation derived from concrete board checks: hung piece (moved to or left attacked-and-underdefended), missed capture, missed mate, walked into a mate threat. Generic fallback: "this loses material — the engine preferred ⟨move⟩."
- The existing hint button gains a one-line "why" from the same template engine.

**Post-game review**
- From the result screen or a past game: analyze every position sequentially (throttled, progress bar; ~200ms/position is comfortably within App Runner's autoscale 1–3 × MaxConcurrency 8).
- Output: accuracy %, per-move classification badges in the replay viewer, and a "key moments" list (largest swings) with the better move shown.

---

## Error handling summary

| Failure | Behavior |
|---|---|
| Auth API unreachable | Sign-in button shows error; play continues as guest |
| Session JWT expired | Silent re-login prompt; features fall back to guest/local |
| `POST /v1/games` fails | Game saved to local history + retry queue; flushed on next launch |
| Multiplayer JWT invalid on connect | Connection proceeds as guest seat (today's behavior) |
| `/v1/analyze` fails | Eval bar hides / falls back to local eval; review can be retried |

## Testing

- **Web:** unit tests per existing patterns — theme application, history store, blunder classification thresholds, template explanations against fixture positions.
- **Server:** accounts Lambda — token verification with mocked JWKS, user upsert/link logic, games store; multiplayer — game-recording path; engine — `/v1/analyze` contract test.
- **iOS:** XCTest for theme registry, history store, classification (mirroring web fixtures).
- **Deploy verification:** extend `scripts/verify-site.sh` with accounts API health + `/v1/analyze` smoke check.

## Phase boundaries

Each phase is independently deployable and gets its own implementation plan and branch. Order: 1 themes → 2 accounts → 3 past games → 4 leaderboard → 5 coach. Phases 3–5 depend on 2 (3 partially — local history is independent); 5 depends on 3's replay viewer.
