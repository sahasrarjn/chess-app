import Foundation

/// Mirrors the web/server GameRecord field-for-field.
struct CompletedGameRecord: Codable, Equatable, Identifiable {
    let gameId: String
    let mode: String           // "vsBot" | "localTwoPlayer" | "online"
    let difficulty: String?    // easy | medium | hard (vsBot only)
    let playerColor: String?   // white | black | nil (pass-and-play)
    let opponent: String
    let moves: [String]
    let resultType: String     // checkmate | stalemate | resignation | draw
    let winner: String?        // white | black | nil
    let endedAt: String        // ISO 8601

    var id: String { gameId }
}

/// Rolling last-25 completed games (guests included), newest first.
enum GameHistoryStore {
    static let maxGames = 25
    private static let key = "chessborder.gameHistory"
    private static let version = 1

    private struct HistoryFile: Codable {
        let version: Int
        var games: [CompletedGameRecord]
    }

    static func load(defaults: UserDefaults = .standard) -> [CompletedGameRecord] {
        guard let data = defaults.data(forKey: key),
              let file = try? JSONDecoder().decode(HistoryFile.self, from: data),
              file.version == version else { return [] }
        return file.games
    }

    /// Prepend, capped at 25. Returns false (storing nothing) when an entry
    /// with the same mode + moves + resultType already exists — guards
    /// re-recording a finished game restored from the resume slot. endedAt is
    /// deliberately excluded from the dedupe key.
    @discardableResult
    static func append(_ record: CompletedGameRecord, defaults: UserDefaults = .standard) -> Bool {
        var games = load(defaults: defaults)
        let dup = games.contains {
            $0.mode == record.mode && $0.resultType == record.resultType && $0.moves == record.moves
        }
        if dup { return false }
        games.insert(record, at: 0)
        if games.count > maxGames { games.removeLast(games.count - maxGames) }
        guard let data = try? JSONEncoder().encode(HistoryFile(version: version, games: games)) else {
            return false
        }
        defaults.set(data, forKey: key)
        return true
    }

    static func clear(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: key)
    }
}
