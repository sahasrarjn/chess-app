import Foundation

extension BotDifficulty {
    var targetElo: Int {
        switch self {
        case .easy: 800
        case .medium: 1200
        case .hard: 1600
        }
    }

    var searchMovetimeMs: Int {
        switch self {
        case .easy: 200
        case .medium: 500
        case .hard: 900
        }
    }

    var minimumThinkingDuration: Duration {
        switch self {
        case .easy: .milliseconds(120)
        case .medium: .milliseconds(200)
        case .hard: .milliseconds(300)
        }
    }
}
