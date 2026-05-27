import Foundation

/// Uses Fairy-Stockfish when bundled; falls back to built-in minimax on device / if engine fails.
struct HybridBotPlayer: BotPlayer {
    private let minimax = MinimaxBotPlayer()

    func chooseMove(in game: ChessGame, difficulty: BotDifficulty) async -> Move? {
        let legal = game.legalMoves()
        guard !legal.isEmpty else {
            BotLogging.debug("chooseMove: no legal moves")
            return nil
        }

        if EngineBundle.isFairyStockfishAvailable,
           let move = await FairyStockfishBot.shared.chooseMove(in: game, difficulty: difficulty) {
            BotLogging.debug("chooseMove: engine \(move.uci)")
            return move
        }

        if let move = await minimax.chooseMove(in: game, difficulty: difficulty),
           move.from.isValid, move.to.isValid {
            BotLogging.debug("chooseMove: minimax fallback \(move.uci)")
            return move
        }

        let fallback = legal.first
        BotLogging.debug("chooseMove: random fallback \(fallback?.uci ?? "none")")
        return fallback
    }
}
