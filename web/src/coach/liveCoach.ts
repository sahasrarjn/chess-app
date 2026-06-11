import type { ChessGame } from "../engine/chessGame";
import type { Move, PieceColor } from "../engine/types";
import { moveUci } from "../engine/types";
import { toFEN } from "../engine/fen";
import {
  classifyMove,
  toWhiteRelative,
  MATE_CP,
  type MoveClassification,
  type PositionEval,
} from "./classify";
import { explainMove, hintWhy } from "./explain";
import { analyzePosition, LIVE_MOVETIME_MS, type AnalyzeFn } from "./analyzeClient";

export interface CoachBanner {
  classification: MoveClassification; // only "mistake" | "blunder" are surfaced
  text: string;
  ply: number;
}

export class LiveCoach {
  enabled = false;
  banner: CoachBanner | null = null;
  isAnalyzing = false;

  /** White-relative eval per ply (set after analysis of each position) */
  private evalByPly = new Map<number, PositionEval>();
  /** Best move + pv for the position *before* each ply (used for explainMove) */
  private bestByPly = new Map<number, { bestMoveUci: string | null; pv: string[] }>();
  /** Latest-wins token (incremented when a new analysis is started) */
  private token = 0;
  private currentAbort: AbortController | null = null;

  constructor(
    private readonly onUpdate: () => void,
    private readonly analyze: AnalyzeFn = analyzePosition
  ) {}

  /** Latest White-relative eval for the eval bar (null = hide). */
  get evalForBar(): PositionEval | null {
    // Return the most recently analyzed eval
    if (this.evalByPly.size === 0) return null;
    let maxPly = -1;
    for (const ply of this.evalByPly.keys()) {
      if (ply > maxPly) maxPly = ply;
    }
    return this.evalByPly.get(maxPly) ?? null;
  }

  evalForPly(ply: number): PositionEval | undefined {
    return this.evalByPly.get(ply);
  }

  /**
   * Call when livePly changed (or on first mount). lastMove/mover describe the
   * move that produced this position; shouldClassify gates the banner.
   */
  onPositionChanged(
    game: ChessGame,
    ply: number,
    lastMove: Move | null,
    fenBefore: string | null,
    mover: PieceColor | null,
    shouldClassify: boolean
  ): void {
    if (!this.enabled) return;

    // Terminal positions: don't analyze, leave bar at last value
    if (game.result.type !== "ongoing") {
      this.isAnalyzing = false;
      // Classify the final move using the before-eval if available
      if (shouldClassify && lastMove && fenBefore && mover) {
        const beforeEval = this.evalByPly.get(ply - 1);
        if (beforeEval != null) {
          // Synthetic after-eval from game result
          let afterEval: PositionEval;
          if (game.result.type === "checkmate") {
            const sign = mover === "white" ? 1 : -1;
            afterEval = { cp: sign * MATE_CP, mateIn: null };
          } else {
            afterEval = { cp: 0, mateIn: null };
          }
          const classification = classifyMove(beforeEval, afterEval, mover);
          if (classification === "mistake" || classification === "blunder") {
            const bestData = this.bestByPly.get(ply - 1) ?? { bestMoveUci: null, pv: [] };
            const text = explainMove({
              fen: fenBefore,
              movePlayed: moveUci(lastMove),
              bestMoveUci: bestData.bestMoveUci,
              pv: bestData.pv,
              before: beforeEval,
              after: afterEval,
              classification,
              mover,
            });
            this.banner = { classification, text, ply };
          }
          this.onUpdate();
        }
      }
      return;
    }

    // Cancel the current in-flight analysis
    this.currentAbort?.abort();
    const abort = new AbortController();
    this.currentAbort = abort;
    const myToken = ++this.token;

    this.isAnalyzing = true;
    const activeColor = game.activeColor;

    void (async () => {
      try {
        const result = await this.analyze(game, LIVE_MOVETIME_MS, abort.signal);

        // Latest-wins: discard if a newer analysis was started
        if (myToken !== this.token) return;

        // Convert to White-relative
        const whiteRelative = toWhiteRelative(result.scoreCp, result.mateIn, activeColor);
        this.evalByPly.set(ply, whiteRelative);
        // Store best move for this position (used for explain when classifying the *next* move)
        this.bestByPly.set(ply, { bestMoveUci: result.bestMoveUci, pv: result.pv });

        this.isAnalyzing = false;

        // Classify the move that led to this position
        if (shouldClassify && lastMove && fenBefore && mover) {
          const beforeEval = this.evalByPly.get(ply - 1);
          if (beforeEval != null) {
            const classification = classifyMove(beforeEval, whiteRelative, mover);
            if (classification === "mistake" || classification === "blunder") {
              // Use best move from the position *before* this move
              const bestData = this.bestByPly.get(ply - 1) ?? { bestMoveUci: null, pv: [] };
              const text = explainMove({
                fen: fenBefore,
                movePlayed: moveUci(lastMove),
                bestMoveUci: bestData.bestMoveUci,
                pv: bestData.pv,
                before: beforeEval,
                after: whiteRelative,
                classification,
                mover,
              });
              this.banner = { classification, text, ply };
            }
          }
        }

        this.onUpdate();
      } catch (err) {
        if (myToken !== this.token) return;
        // AbortError: cancelled by latest-wins — silently discard
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Any other failure: hide eval bar, clear analysis state
        this.isAnalyzing = false;
        // Don't clear already-cached evals; just don't add a new one
        this.onUpdate();
      } finally {
        if (myToken === this.token) {
          this.isAnalyzing = false;
          if (this.currentAbort === abort) {
            this.currentAbort = null;
          }
        }
      }
    })();
  }

  hintWhyText(game: ChessGame, hintMove: Move): string | null {
    const fen = toFEN(game);
    const currentPly = game.recordedMoves.length;
    const eval_ = this.evalByPly.get(currentPly) ?? null;
    if (eval_ == null) return null;
    return hintWhy(fen, moveUci(hintMove), eval_, game.activeColor);
  }

  dismissBanner(): void {
    this.banner = null;
    this.onUpdate();
  }

  /** New game: clear all per-game state */
  reset(): void {
    this.currentAbort?.abort();
    this.currentAbort = null;
    this.token++;
    this.evalByPly.clear();
    this.bestByPly.clear();
    this.banner = null;
    this.isAnalyzing = false;
  }

  dispose(): void {
    this.reset();
  }
}
