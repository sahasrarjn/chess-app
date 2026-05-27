import Foundation

/// Calls a self-hosted Fairy-Stockfish HTTP API (see `/server` in the repo).
struct RemoteEngineBot: BotPlayer {
    func chooseMove(in game: ChessGame, difficulty: BotDifficulty) async -> Move? {
        guard let baseURL = BotServerConfig.baseURL else {
            BotLogging.debug("RemoteEngine: no server URL configured")
            return nil
        }

        let endpoint = baseURL.appendingPathComponent("v1/move")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let apiKey = BotServerConfig.apiKey {
            request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        }
        request.timeoutInterval = 15

        let payload = RemoteMoveRequest(
            fen: game.toFEN(),
            elo: difficulty.targetElo,
            movetimeMs: difficulty.searchMovetimeMs
        )

        do {
            request.httpBody = try JSONEncoder().encode(payload)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                BotLogging.debug("RemoteEngine: HTTP \((response as? HTTPURLResponse)?.statusCode ?? -1)")
                return nil
            }
            let decoded = try JSONDecoder().decode(RemoteMoveResponse.self, from: data)
            guard let move = game.move(fromEngineUCI: decoded.uci) else {
                BotLogging.debug("RemoteEngine: illegal UCI \(decoded.uci)")
                return nil
            }
            BotLogging.debug("RemoteEngine: \(decoded.uci)")
            return move
        } catch {
            BotLogging.debug("RemoteEngine: \(error.localizedDescription)")
            return nil
        }
    }
}

private struct RemoteMoveRequest: Encodable {
    let fen: String
    let elo: Int
    let movetimeMs: Int

    enum CodingKeys: String, CodingKey {
        case fen
        case elo
        case movetimeMs = "movetime_ms"
    }
}

private struct RemoteMoveResponse: Decodable {
    let uci: String
}
