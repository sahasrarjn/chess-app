import Foundation

/// Calls a self-hosted Fairy-Stockfish HTTP API (see `/server` in the repo).
struct RemoteEngineBot: BotPlayer {
    func chooseMove(in game: ChessGame, difficulty: BotDifficulty) async -> Move? {
        guard let baseURL = BotServerConfig.baseURL else {
            BotLogging.debug("RemoteEngine: no server URL configured")
            return nil
        }

        let fen = game.toFEN()
        let payload = RemoteMoveRequest(
            fen: fen,
            elo: difficulty.targetElo,
            movetimeMs: difficulty.searchMovetimeMs
        )
        let endpoint = baseURL.appendingPathComponent("v1/move")
        let apiKey = BotServerConfig.apiKey

        let uci = await Task.detached(priority: .userInitiated) {
            await Self.fetchUCIMove(endpoint: endpoint, payload: payload, apiKey: apiKey)
        }.value

        guard let uci else { return nil }
        guard let move = game.move(fromEngineUCI: uci) else {
            BotLogging.debug("RemoteEngine: illegal UCI \(uci) for FEN \(fen)")
            return nil
        }
        BotLogging.debug("RemoteEngine: \(uci)")
        return move
    }

    private static func fetchUCIMove(
        endpoint: URL,
        payload: RemoteMoveRequest,
        apiKey: String?
    ) async -> String? {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let apiKey {
            request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        }
        request.timeoutInterval = 15

        do {
            request.httpBody = try JSONEncoder().encode(payload)
            BotLogging.debug("RemoteEngine: POST \(endpoint.absoluteString)")
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                BotLogging.debug("RemoteEngine: non-HTTP response")
                return nil
            }
            guard (200...299).contains(http.statusCode) else {
                let body = String(data: data, encoding: .utf8) ?? ""
                BotLogging.debug("RemoteEngine: HTTP \(http.statusCode) \(body)")
                return nil
            }
            let decoded = try JSONDecoder().decode(RemoteMoveResponse.self, from: data)
            return decoded.uci
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
