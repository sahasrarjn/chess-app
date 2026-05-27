import Foundation

/// GPL v3 — [Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish) (Stockfish derivative).
actor FairyStockfishBot: BotPlayer {
    static let shared = FairyStockfishBot()

    #if os(macOS)
    private var macClient: UCIProcessClient?
    #elseif os(iOS) && targetEnvironment(simulator)
    private var simClient: UCISpawnClient?
    #endif
    private var isVariantConfigured = false
    private var configuredElo: Int?

    func chooseMove(in game: ChessGame, difficulty: BotDifficulty) async -> Move? {
        guard EngineBundle.isFairyStockfishAvailable,
              let engineURL = EngineBundle.fairyStockfishURL else {
            BotLogging.debug("FairyStockfish: binary unavailable")
            return nil
        }

        do {
            #if os(macOS)
            if macClient == nil {
                macClient = try UCIProcessClient(binaryURL: engineURL)
                try await macClient?.bootstrap()
            }
            guard let client = macClient else { return nil }
            return try await runSearch(client: client, game: game, difficulty: difficulty)
            #elseif os(iOS) && targetEnvironment(simulator)
            if simClient == nil {
                simClient = try UCISpawnClient(binaryURL: engineURL)
                try await simClient?.bootstrap()
            }
            guard let client = simClient else { return nil }
            return try await runSearch(client: client, game: game, difficulty: difficulty)
            #else
            return nil
            #endif
        } catch {
            BotLogging.debug("FairyStockfish: error \(error.localizedDescription)")
            return nil
        }
    }

    #if os(macOS)
    private func runSearch(client: UCIProcessClient, game: ChessGame, difficulty: BotDifficulty) async throws -> Move? {
        try await sendSearch(client: client, game: game, difficulty: difficulty)
    }
    #elseif os(iOS) && targetEnvironment(simulator)
    private func runSearch(client: UCISpawnClient, game: ChessGame, difficulty: BotDifficulty) async throws -> Move? {
        try await sendSearch(client: client, game: game, difficulty: difficulty)
    }
    #endif

    #if os(macOS)
    private func sendSearch(client: UCIProcessClient, game: ChessGame, difficulty: BotDifficulty) async throws -> Move? {
        try await configureVariantIfNeeded(client: client)
        try await configureStrength(client: client, difficulty: difficulty)

        try await client.send("stop")
        try await client.send("position fen \(game.toFEN())")
        client.discardPendingOutput()
        try await client.send("go movetime \(difficulty.searchMovetimeMs)")

        guard let line = await client.waitForLine(containing: "bestmove", timeout: 5),
              let uci = Self.parseBestMove(line) else {
            BotLogging.debug("FairyStockfish: no bestmove line")
            return nil
        }
        return resolveEngineMove(uci, in: game)
    }
    #elseif os(iOS) && targetEnvironment(simulator)
    private func sendSearch(client: UCISpawnClient, game: ChessGame, difficulty: BotDifficulty) async throws -> Move? {
        try await configureVariantIfNeeded(client: client)
        try await configureStrength(client: client, difficulty: difficulty)

        try await client.send("stop")
        try await client.send("position fen \(game.toFEN())")
        client.discardPendingOutput()
        try await client.send("go movetime \(difficulty.searchMovetimeMs)")

        guard let line = await client.waitForLine(containing: "bestmove", timeout: 5),
              let uci = Self.parseBestMove(line) else { return nil }
        return resolveEngineMove(uci, in: game)
    }
    #endif

    #if os(macOS)
    private func configureVariantIfNeeded(client: UCIProcessClient) async throws {
        guard !isVariantConfigured else { return }
        if let variants = EngineBundle.variantsURL {
            try await client.send("setoption name VariantPath value \(variants.path)")
        }
        try await client.send("setoption name UCI_Variant value chessborder")
        try await client.send("isready")
        _ = await client.waitForLine(containing: "readyok", timeout: 5)
        isVariantConfigured = true
    }

    private func configureStrength(client: UCIProcessClient, difficulty: BotDifficulty) async throws {
        let elo = difficulty.targetElo
        guard configuredElo != elo else { return }
        try await client.send("setoption name UCI_LimitStrength value true")
        try await client.send("setoption name UCI_Elo value \(elo)")
        configuredElo = elo
    }
    #elseif os(iOS) && targetEnvironment(simulator)
    private func configureVariantIfNeeded(client: UCISpawnClient) async throws {
        guard !isVariantConfigured else { return }
        if let variants = EngineBundle.variantsURL {
            try await client.send("setoption name VariantPath value \(variants.path)")
        }
        try await client.send("setoption name UCI_Variant value chessborder")
        try await client.send("isready")
        _ = await client.waitForLine(containing: "readyok", timeout: 5)
        isVariantConfigured = true
    }

    private func configureStrength(client: UCISpawnClient, difficulty: BotDifficulty) async throws {
        let elo = difficulty.targetElo
        guard configuredElo != elo else { return }
        try await client.send("setoption name UCI_LimitStrength value true")
        try await client.send("setoption name UCI_Elo value \(elo)")
        configuredElo = elo
    }
    #endif

    private func resolveEngineMove(_ uci: String, in game: ChessGame) -> Move? {
        guard let move = game.move(fromEngineUCI: uci) else {
            BotLogging.debug("FairyStockfish: UCI \(uci) not legal in app rules")
            return nil
        }
        guard move.from.isValid, move.to.isValid else {
            BotLogging.debug("FairyStockfish: UCI \(uci) out of bounds")
            return nil
        }
        return move
    }

    private static func parseBestMove(_ line: String) -> String? {
        let parts = line.split(separator: " ")
        guard parts.count >= 2, parts[0] == "bestmove" else { return nil }
        let move = String(parts[1])
        return move == "(none)" ? nil : move
    }
}

extension BotDifficulty {
    var targetElo: Int {
        switch self {
        case .easy: 1200
        case .medium: 1600
        case .hard: 2200
        }
    }

    var minimumThinkingDuration: Duration {
        switch self {
        case .easy: .milliseconds(150)
        case .medium: .milliseconds(200)
        case .hard: .milliseconds(300)
        }
    }
}

enum BotProvider {
    static func player() -> any BotPlayer {
        HybridBotPlayer()
    }

    static var engineName: String {
        if EngineBundle.isFairyStockfishAvailable {
            return "Fairy-Stockfish"
        }
        #if os(iOS) && !targetEnvironment(simulator)
        return "Built-in minimax (device)"
        #else
        return "Built-in minimax"
        #endif
    }
}
