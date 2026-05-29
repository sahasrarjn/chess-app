import Foundation

struct SavedGameSnapshot: Codable, Equatable {
    static let currentVersion = 1

    let version: Int
    let mode: String
    let botDifficulty: String
    let moves: [String]
    let resignedBy: String?
    let boardFlipped: Bool
    let autoFlipBoard: Bool

    var gameMode: GameMode? {
        switch mode {
        case "vsBot": return .vsBot
        case "localTwoPlayer": return .localTwoPlayer
        default: return nil
        }
    }

    var difficulty: BotDifficulty? {
        switch botDifficulty.lowercased() {
        case "easy": return .easy
        case "medium": return .medium
        case "hard": return .hard
        default: return nil
        }
    }

    var resignedColor: PieceColor? {
        switch resignedBy {
        case "white": return .white
        case "black": return .black
        default: return nil
        }
    }
}

enum SavedGameStore {
    private static let key = "chessborder.savedGame"

    static func load() -> SavedGameSnapshot? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        do {
            let saved = try JSONDecoder().decode(SavedGameSnapshot.self, from: data)
            guard saved.version == SavedGameSnapshot.currentVersion,
                  saved.gameMode != nil,
                  saved.difficulty != nil,
                  restoreGame(from: saved) != nil else {
                clear()
                return nil
            }
            return saved
        } catch {
            clear()
            return nil
        }
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }

    static func restoreGame(from saved: SavedGameSnapshot) -> ChessGame? {
        let game = ChessGame()
        for uci in saved.moves {
            guard let move = game.move(from: uci), game.applyMove(move) else { return nil }
        }
        if let resigned = saved.resignedColor {
            game.resign(by: resigned)
        }
        return game
    }

    @MainActor
    static func save(from viewModel: GameViewModel) {
        guard shouldPersist(viewModel) else { return }
        let snapshot = snapshot(from: viewModel)
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    @MainActor
    private static func shouldPersist(_ viewModel: GameViewModel) -> Bool {
        viewModel.livePly > 0 || viewModel.game.result != .ongoing
    }

    @MainActor
    private static func snapshot(from viewModel: GameViewModel) -> SavedGameSnapshot {
        SavedGameSnapshot(
            version: SavedGameSnapshot.currentVersion,
            mode: viewModel.mode == .vsBot ? "vsBot" : "localTwoPlayer",
            botDifficulty: viewModel.botDifficulty.rawValue.lowercased(),
            moves: viewModel.game.recordedMoves.map(\.move.uci),
            resignedBy: resignedByString(viewModel.game.resignedBy),
            boardFlipped: viewModel.boardFlipped,
            autoFlipBoard: viewModel.autoFlipBoard
        )
    }

    private static func resignedByString(_ color: PieceColor?) -> String? {
        switch color {
        case .white: return "white"
        case .black: return "black"
        case nil: return nil
        }
    }
}
