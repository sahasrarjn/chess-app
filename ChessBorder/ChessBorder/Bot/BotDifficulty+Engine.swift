import Foundation

extension BotDifficulty {
    var targetElo: Int {
        switch self {
        case .easy: 1000
        case .medium: 1400
        case .hard: 2000
        }
    }

    var searchMovetimeMs: Int {
        switch self {
        case .easy: 300
        case .medium: 500
        case .hard: 900
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
