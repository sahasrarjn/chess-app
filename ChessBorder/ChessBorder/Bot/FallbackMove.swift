import Foundation

/// Built-in minimax when the remote engine is unavailable.
func pickFallbackMove(in game: ChessGame, difficulty: BotDifficulty) -> Move? {
    ChessBot(difficulty: difficulty).chooseMove(in: game)
}
