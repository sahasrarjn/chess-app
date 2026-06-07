import Foundation

enum GameMode: String, CaseIterable, Identifiable {
    case vsBot = "Play vs Bot"
    case localTwoPlayer = "Play with Friend"

    var id: String { rawValue }
}

enum BotDifficulty: String, CaseIterable, Identifiable {
    case easy = "Easy"
    case medium = "Medium"
    case hard = "Hard"

    var id: String { rawValue }

    var searchDepth: Int {
        switch self {
        case .easy: 1
        case .medium: 3
        case .hard: 4
        }
    }

    var randomness: Double {
        switch self {
        case .easy: 0.6
        case .medium: 0.12
        case .hard: 0.0
        }
    }
}

enum GameResult: Equatable {
    case ongoing
    case checkmate(winner: PieceColor)
    case stalemate
    case resignation(winner: PieceColor)
    case draw(reason: String)
}
