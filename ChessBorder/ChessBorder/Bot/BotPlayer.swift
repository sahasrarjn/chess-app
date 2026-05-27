import Foundation

protocol BotPlayer {
    func chooseMove(in game: ChessGame, difficulty: BotDifficulty) async -> Move?
}

/// Built-in minimax bot (fallback when Fairy-Stockfish binary is not bundled).
struct MinimaxBotPlayer: BotPlayer {
    func chooseMove(in game: ChessGame, difficulty: BotDifficulty) async -> Move? {
        let snapshot = game.copy()
        return await Task.detached(priority: .userInitiated) {
            ChessBot(difficulty: difficulty).chooseMove(in: snapshot)
        }.value
    }
}
