/// <reference lib="webworker" />

import { ChessGame } from "../engine/chessGame";
import type { BotDifficulty } from "../engine/types";
import type { BotSearchState } from "../engine/chessGame";
import { chooseMinimaxMoveTimed } from "./chessBot";

export type BotWorkerRequest = {
  state: BotSearchState;
  difficulty: BotDifficulty;
  maxMs: number;
};

export type BotWorkerResponse = {
  move: ReturnType<typeof chooseMinimaxMoveTimed>;
};

self.onmessage = (event: MessageEvent<BotWorkerRequest>) => {
  const { state, difficulty, maxMs } = event.data;
  const game = ChessGame.fromSearchState(state);
  const move = chooseMinimaxMoveTimed(game, difficulty, maxMs);
  const response: BotWorkerResponse = { move };
  self.postMessage(response);
};
