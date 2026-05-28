import Foundation

/// Remote server (iPhone / offline fallback) → local Fairy-Stockfish (Mac / iOS Simulator) → minimax fallback.
struct HybridBotPlayer: BotPlayer {
    private let remote = RemoteEngineBot()
    private let minimax = MinimaxBotPlayer()

    func chooseMove(in game: ChessGame, difficulty: BotDifficulty) async -> Move? {
        let legal = game.legalMoves()
        guard !legal.isEmpty else {
            BotLogging.debug("chooseMove: no legal moves")
            return nil
        }

        #if os(iOS)
        if BotServerConfig.isConfigured,
           let move = await remote.chooseMove(in: game, difficulty: difficulty) {
            BotLogging.debug("chooseMove: remote engine \(move.uci)")
            return move
        }

        if EngineBundle.isFairyStockfishAvailable,
           let move = await FairyStockfishBot.shared.chooseMove(in: game, difficulty: difficulty) {
            BotLogging.debug("chooseMove: local engine \(move.uci)")
            return move
        }
        #else
        if EngineBundle.isFairyStockfishAvailable,
           let move = await FairyStockfishBot.shared.chooseMove(in: game, difficulty: difficulty) {
            BotLogging.debug("chooseMove: local engine \(move.uci)")
            return move
        }

        if BotServerConfig.isConfigured,
           let move = await remote.chooseMove(in: game, difficulty: difficulty) {
            BotLogging.debug("chooseMove: remote engine \(move.uci)")
            return move
        }
        #endif

        if let move = await minimax.chooseMove(in: game, difficulty: difficulty),
           move.from.isValid, move.to.isValid {
            BotLogging.debug("chooseMove: minimax fallback \(move.uci)")
            return move
        }

        BotLogging.debug("chooseMove: no engine available")
        return nil
    }
}

enum BotProvider {
    static func player() -> any BotPlayer {
        HybridBotPlayer()
    }

    static var engineName: String {
        #if os(iOS)
        if BotServerConfig.isConfigured {
            return "Fairy-Stockfish (server)"
        }
        if EngineBundle.isFairyStockfishAvailable {
            return "Fairy-Stockfish (local)"
        }
        return "Built-in bot"
        #else
        if EngineBundle.isFairyStockfishAvailable {
            return "Fairy-Stockfish (local)"
        }
        if BotServerConfig.isConfigured {
            return "Fairy-Stockfish (server)"
        }
        return "Minimax fallback"
        #endif
    }
}
