import Foundation

/// Calls a self-hosted Fairy-Stockfish HTTP API (see `/server` in the repo).
struct RemoteEngineBot: BotPlayer {
    func chooseMove(in game: ChessGame, difficulty: BotDifficulty) async -> Move? {
        let result = await chooseMoveResult(in: game, difficulty: difficulty)
        return result.move
    }

    func chooseMoveResult(in game: ChessGame, difficulty: BotDifficulty) async -> RemoteEngineResult {
        guard let baseURL = BotServerConfig.baseURL else {
            BotLogging.debug("RemoteEngine: no server URL configured")
            return RemoteEngineResult(move: nil, uci: nil, error: nil)
        }

        let fen = game.toFEN()
        let payload = RemoteMoveRequest(
            fen: fen,
            elo: difficulty.targetElo,
            movetimeMs: difficulty.searchMovetimeMs
        )
        let endpoint = baseURL.appendingPathComponent("v1/move")
        let apiKey = BotServerConfig.apiKey

        let fetchResult = await Task.detached(priority: .userInitiated) {
            await Self.fetchUCIMove(endpoint: endpoint, payload: payload, apiKey: apiKey)
        }.value

        switch fetchResult {
        case .success(let uci):
            guard let move = game.move(fromEngineUCI: uci) else {
                BotLogging.debug("RemoteEngine: illegal UCI \(uci) for FEN \(fen)")
                return RemoteEngineResult(move: nil, uci: uci, error: nil)
            }
            BotLogging.debug("RemoteEngine: \(uci)")
            return RemoteEngineResult(move: move, uci: uci, error: nil)
        case .failure(let error):
            return RemoteEngineResult(move: nil, uci: nil, error: error.message)
        }
    }

    private static func fetchUCIMove(
        endpoint: URL,
        payload: RemoteMoveRequest,
        apiKey: String?
    ) async -> Result<String, RemoteEngineFailure> {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let apiKey {
            request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        }
        request.timeoutInterval = 40

        let maxAttempts = 3
        var lastFailure: RemoteEngineFailure = .network("Cannot reach the chess engine")

        for attempt in 0..<maxAttempts {
            do {
                request.httpBody = try JSONEncoder().encode(payload)
                BotLogging.debug("RemoteEngine: POST \(endpoint.absoluteString) attempt=\(attempt + 1)")
                let (data, response) = try await URLSession.shared.data(for: request)
                if let http = response as? HTTPURLResponse {
                    if (200...299).contains(http.statusCode) {
                        let decoded = try JSONDecoder().decode(RemoteMoveResponse.self, from: data)
                        return .success(decoded.uci)
                    }
                    let body = String(data: data, encoding: .utf8) ?? ""
                    BotLogging.debug("RemoteEngine: HTTP \(http.statusCode) \(body)")
                    let message = parseHTTPError(
                        status: http.statusCode,
                        body: body,
                        retryAfterHeader: http.value(forHTTPHeaderField: "Retry-After")
                    )
                    lastFailure = .httpError(message)
                    if [429, 502, 503, 504].contains(http.statusCode), attempt < maxAttempts - 1 {
                        try await Task.sleep(for: .milliseconds(400 * (attempt + 1)))
                        continue
                    }
                    return .failure(lastFailure)
                }
                BotLogging.debug("RemoteEngine: non-HTTP response")
                lastFailure = .invalidResponse
            } catch let error as URLError where error.code == .timedOut {
                BotLogging.debug("RemoteEngine: timed out")
                lastFailure = .timedOut
            } catch {
                BotLogging.debug("RemoteEngine: \(error.localizedDescription)")
                lastFailure = .network(error.localizedDescription)
            }

            if attempt < maxAttempts - 1 {
                try? await Task.sleep(for: .milliseconds(500 * (attempt + 1)))
            }
        }

        return .failure(lastFailure)
    }

    private static func parseHTTPError(status: Int, body: String, retryAfterHeader: String?) -> String {
        var detail = body
        var retryAfterSeconds: Int?

        if let data = body.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let error = json["error"] as? String {
                detail = error
            } else if let serverDetail = json["detail"] as? String {
                detail = serverDetail
            }
            if let retry = json["retry_after_seconds"] as? Int, retry > 0 {
                retryAfterSeconds = retry
            }
        }

        if retryAfterSeconds == nil, let retryAfterHeader,
           let parsed = Int(retryAfterHeader), parsed > 0 {
            retryAfterSeconds = parsed
        }

        let base = detail.isEmpty ? "Engine HTTP \(status)" : detail
        if status == 429, let retryAfterSeconds {
            return "\(base) Retry in ~\(retryAfterSeconds)s."
        }
        return base
    }
}

struct RemoteEngineResult {
    let move: Move?
    let uci: String?
    let error: String?
}

private enum RemoteEngineFailure: Error {
    case invalidResponse
    case timedOut
    case network(String)
    case httpError(String)

    var message: String {
        switch self {
        case .invalidResponse:
            return "Engine returned an invalid response."
        case .timedOut:
            return "Engine request timed out"
        case .network(let detail):
            return detail
        case .httpError(let detail):
            return detail
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
