import Foundation

// EngineAnalysis is side-to-move perspective
struct EngineAnalysis {
    let scoreCp: Int?        // side-to-move perspective
    let mateIn: Int?
    let bestMoveUci: String?
    let pv: [String]
    let source: Source
    enum Source { case server, localEngine, minimax }
}

struct AnalyzeService {
    static let shared = AnalyzeService()
    static let liveMovetimeMs = 400
    static let reviewMovetimeMs = 200

    // Remote -> local Fairy-Stockfish -> ChessBot minimax. Platform order matches
    // HybridBotPlayer: iOS tries the server first; Mac/simulator tries local FSF first.
    func analyse(in game: ChessGame, movetimeMs: Int) async -> EngineAnalysis? {
        let fen = game.toFEN()

        #if os(iOS)
        // iOS physical device: remote first
        if let analysis = await remoteAnalysis(fen: fen, movetimeMs: movetimeMs) {
            return analysis
        }
        if EngineBundle.isFairyStockfishAvailable,
           let analysis = await FairyStockfishBot.shared.analyse(fen: fen, movetimeMs: movetimeMs) {
            return analysis
        }
        #else
        // macOS / simulator: local FSF first
        if EngineBundle.isFairyStockfishAvailable,
           let analysis = await FairyStockfishBot.shared.analyse(fen: fen, movetimeMs: movetimeMs) {
            return analysis
        }
        if let analysis = await remoteAnalysis(fen: fen, movetimeMs: movetimeMs) {
            return analysis
        }
        #endif

        // Minimax fallback
        return minimaxAnalysis(game: game)
    }

    // MARK: - Remote leg

    private func remoteAnalysis(fen: String, movetimeMs: Int) async -> EngineAnalysis? {
        guard let baseURL = BotServerConfig.baseURL else { return nil }
        let endpoint = baseURL.appendingPathComponent("v1/analyze")
        let payload = RemoteAnalyzeRequest(fen: fen, movetimeMs: movetimeMs)

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 15

        for attempt in 0..<2 {
            do {
                request.httpBody = try JSONEncoder().encode(payload)
                let (data, response) = try await URLSession.shared.data(for: request)
                if let http = response as? HTTPURLResponse {
                    if (200...299).contains(http.statusCode) {
                        let decoded = try JSONDecoder().decode(RemoteAnalyzeResponse.self, from: data)
                        let bestMove = decoded.bestMoveUci
                        return EngineAnalysis(
                            scoreCp: decoded.scoreCp,
                            mateIn: decoded.mateIn,
                            bestMoveUci: bestMove,
                            pv: decoded.pv,
                            source: .server
                        )
                    }
                    if [429, 500, 502, 503, 504].contains(http.statusCode), attempt == 0 {
                        try? await Task.sleep(for: .milliseconds(400))
                        continue
                    }
                    return nil
                }
            } catch {
                if attempt == 0 {
                    try? await Task.sleep(for: .milliseconds(400))
                    continue
                }
                return nil
            }
        }
        return nil
    }

    // MARK: - Minimax fallback

    private func minimaxAnalysis(game: ChessGame) -> EngineAnalysis? {
        let legal = game.legalMoves()
        guard !legal.isEmpty else { return nil }

        let snapshot = game.copy()
        let cp = ChessBot(difficulty: .hard).evaluateCp(game: snapshot, for: snapshot.activeColor)
        let bestMove = ChessBot(difficulty: .hard).chooseMove(in: snapshot)
        let bestUci = bestMove?.uci
        return EngineAnalysis(
            scoreCp: cp,
            mateIn: nil,
            bestMoveUci: bestUci,
            pv: [bestUci].compactMap { $0 },
            source: .minimax
        )
    }
}

// MARK: - Codable types

private struct RemoteAnalyzeRequest: Encodable {
    let fen: String
    let movetimeMs: Int

    enum CodingKeys: String, CodingKey {
        case fen
        case movetimeMs = "movetime_ms"
    }
}

private struct RemoteAnalyzeResponse: Decodable {
    let scoreCp: Int?
    let mateIn: Int?
    let bestMoveUci: String?
    let pv: [String]

    enum CodingKeys: String, CodingKey {
        case scoreCp = "score_cp"
        case mateIn = "mate_in"
        case bestMoveUci = "best_move_uci"
        case pv
    }
}
