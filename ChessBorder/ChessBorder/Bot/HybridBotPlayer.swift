import Foundation

/// Local Fairy-Stockfish (Mac / iOS Simulator) → remote server (physical iPhone) → macOS minimax fallback only.
struct HybridBotPlayer: BotPlayer {
    private let remote = RemoteEngineBot()
    #if os(macOS)
    private let minimax = MinimaxBotPlayer()
    #endif

    func chooseMove(in game: ChessGame, difficulty: BotDifficulty) async -> Move? {
        let legal = game.legalMoves()
        guard !legal.isEmpty else {
            BotLogging.debug("chooseMove: no legal moves")
            return nil
        }

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

        #if os(macOS)
        if let move = await minimax.chooseMove(in: game, difficulty: difficulty),
           move.from.isValid, move.to.isValid {
            BotLogging.debug("chooseMove: minimax fallback \(move.uci)")
            return move
        }
        #endif

        BotLogging.debug("chooseMove: no engine available")
        return nil
    }
}

enum BotProvider {
    static func player() -> any BotPlayer {
        HybridBotPlayer()
    }

    static var engineName: String {
        if EngineBundle.isFairyStockfishAvailable {
            return "Fairy-Stockfish (local)"
        }
        if BotServerConfig.isConfigured {
            return "Fairy-Stockfish (server)"
        }
        #if os(iOS)
        return "Fairy-Stockfish"
        #else
        return "Minimax fallback"
        #endif
    }
}
