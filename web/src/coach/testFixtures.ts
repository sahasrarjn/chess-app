/**
 * Shared Border Chess fixtures for classify and explain tests.
 * Ten positions with FEN, moves played, engine best, White-relative evals,
 * and expected classification and category labels.
 *
 * FENs use the client 10×10 chessborder format (border ring of `.`, inner
 * squares b–i / ranks 2–9 of the grid; standard inner notation a1–h8 in UCI).
 *
 * IMPORTANT: Mate metadata (#5/#6) is fixture input, not engine truth — verify
 * against the bundled Mac fairy-stockfish before shipping and adjust if
 * border-square escapes break the expected patterns.
 */

import type { MoveClassification, PositionEval } from "./classify";
import type { PieceColor } from "../engine/types";

export interface TestFixture {
  name: string;
  fen: string;
  movePlayed: string;
  bestMoveUci: string;
  pv: string[];
  before: PositionEval;
  after: PositionEval;
  mover: PieceColor;
  expectedClassification: MoveClassification;
  /** Short description of the expected explanation category */
  expectedCategory: string;
}

function cp(n: number): PositionEval {
  return { cp: n, mateIn: null };
}

function mate(n: number): PositionEval {
  return { cp: null, mateIn: n };
}

export const FIXTURES: TestFixture[] = [
  {
    name: "HUNG_QUEEN",
    // White queen d1, white king e1; black rook e8, black king f8.
    // Queen blunders to d5 where the rook can take it; best was d1h5.
    fen: "........../....rk..../........../........../........../........../........../........../....QK..../.......... w - - 0 1",
    movePlayed: "d1d5",
    bestMoveUci: "d1h5",
    pv: ["d1h5"],
    before: cp(+50),
    after: cp(-850),
    mover: "white",
    expectedClassification: "blunder",
    expectedCategory: "hung piece (Q on d5, Rd8 attacks, 0 defenders)",
  },
  {
    name: "HUNG_KNIGHT",
    // White knight g1, white king e1; black king f8, black pawn e4.
    // Knight moves to f3 where the e4 pawn attacks it; best was g1h3.
    fen: "........../.....k..../........../........../........../.....p..../........../........../.....K.N../.......... w - - 0 1",
    movePlayed: "g1f3",
    bestMoveUci: "g1h3",
    pv: ["g1h3"],
    before: cp(+20),
    after: cp(-250),
    mover: "white",
    expectedClassification: "mistake",
    expectedCategory: "hung piece (N on f3, pawn e4 attacks, lower-value attacker)",
  },
  {
    name: "MISSED_CAPTURE_QUEEN",
    // White rook d1, white king e1; black queen d5, black king f8.
    // Played a useless king move e1e2 instead of Rxd5 winning the queen.
    fen: "........../.....k..../........../........../....q...../........../........../........../....RK..../.......... w - - 0 1",
    movePlayed: "e1e2",
    bestMoveUci: "d1d5",
    pv: ["d1d5"],
    before: cp(+500),
    after: cp(-350),
    mover: "white",
    expectedClassification: "blunder",
    expectedCategory: "missed capture (Rxd5 wins the queen)",
  },
  {
    name: "MISSED_CAPTURE_ROOK",
    // White bishop c1, white king e1; black rook g5, black king f8.
    // Played a useless king move e1d1 instead of Bxg5 winning the rook.
    fen: "........../.....k..../........../........../.......r../........../........../........../...B.K..../.......... w - - 0 1",
    movePlayed: "e1d1",
    bestMoveUci: "c1g5",
    pv: ["c1g5"],
    before: cp(+480),
    after: cp(-20),
    mover: "white",
    expectedClassification: "blunder",
    expectedCategory: "missed capture (Bxg5 wins the rook)",
  },
  {
    name: "MISSED_MATE_1",
    // White queen g1, white king f7; black king h8.
    // Played a quiet g1g2 instead of Qg8# (mate in 1).
    fen: "........../........k./......K.../........../........../........../........../........../.......Q../.......... w - - 0 1",
    movePlayed: "g1g2",
    bestMoveUci: "g1g8",
    pv: ["g1g8"],
    before: mate(+1),
    after: cp(+900),
    mover: "white",
    expectedClassification: "mistake",
    expectedCategory: "missed mate (mate in 1 with g1g8)",
  },
  {
    name: "MISSED_MATE_2",
    // White rooks b8 and c1, white king f1; black king f9.
    // Played a useless king move e1d1 instead of Rbb8# in two.
    fen: "........../.....k..../.R......../........../........../........../........../........../..R..K..../.......... w - - 0 1",
    movePlayed: "e1d1",
    bestMoveUci: "b1b8",
    pv: ["b1b8"],
    before: mate(+2),
    after: cp(+1200),
    mover: "white",
    expectedClassification: "mistake",
    expectedCategory: "missed mate (mate in 2 with b1b8)",
  },
  {
    name: "WALKED_INTO_MATE_1",
    // Black queen e5, black bishop d4; white pawns g2/h2/i2, white king h1.
    // Pawn advance h2h3 allows mate in 2; best was g1f1.
    fen: "........../.....k..../........../....q...../...b....../........../........../......PPP./.......K../.......... w - - 0 1",
    movePlayed: "h2h3",
    bestMoveUci: "g1f1",
    pv: ["g1f1"],
    before: cp(-80),
    after: mate(-2),
    mover: "white",
    expectedClassification: "blunder",
    expectedCategory: "walked into mate (mate in 2 against)",
  },
  {
    name: "WALKED_INTO_MATE_2",
    // Black king h9, black pawns g7/h7/i7; white queen e3, white king f1.
    // Black pawn advance h7h6 allows Qg8#; best was king h8.
    fen: "........../.......k../......ppp./........../........../........../....Q...../........../.....K..../.......... b - - 0 1",
    movePlayed: "h7h6",
    bestMoveUci: "g8h8",
    pv: ["g8h8"],
    before: cp(+60),
    after: mate(+1),
    mover: "black",
    expectedClassification: "blunder",
    expectedCategory: "walked into mate (mover is black)",
  },
  {
    name: "GENERIC_1",
    // Start position; played b1a3 (knight to border) instead of e2e4.
    fen: "........../.rnbqkbnr./.pppppppp./......../......../......../......../.PPPPPPPP./.RNBQKBNR./.......... w KQkq - 0 1",
    movePlayed: "b1a3",
    bestMoveUci: "e2e4",
    pv: ["e2e4"],
    before: cp(+25),
    after: cp(-135),
    mover: "white",
    expectedClassification: "mistake",
    expectedCategory: "generic fallback",
  },
  {
    name: "GENERIC_2",
    // After 1. e4 (white); black to move. Played g8h6 (knight to border) instead of e7e5.
    // Row 5 = e4 pawn (.....P....), row 7 = white pawns without e pawn (.PPPP.PPP.)
    fen: "........../.rnbqkbnr./.pppppppp./........../.......  ./.....P..../........../.PPPP.PPP./.RNBQKBNR./.......... b KQkq - 0 1".replace("  ", ".."),
    movePlayed: "g8h6",
    bestMoveUci: "e7e5",
    pv: ["e7e5"],
    before: cp(+30),
    after: cp(+190),
    mover: "black",
    expectedClassification: "mistake",
    expectedCategory: "generic fallback (mover is black)",
  },
];

export const START_FEN =
  "........../.rnbqkbnr./.pppppppp./......../......../......../......../.PPPPPPPP./.RNBQKBNR./.......... w KQkq - 0 1";
