import SwiftUI

enum BoardTheme {
    static let lightSquare = Color(red: 0.93, green: 0.93, blue: 0.82)
    static let darkSquare = Color(red: 0.46, green: 0.59, blue: 0.33)
    /// Border uses the same checker as the inner board — empty frame, not a separate zone.
    static let borderLightSquare = lightSquare
    static let borderDarkSquare = darkSquare
    static let selected = Color(red: 0.85, green: 0.72, blue: 0.18).opacity(0.55)
    static let lastMove = Color(red: 0.85, green: 0.72, blue: 0.18).opacity(0.35)
    static let legalMove = Color(red: 0.15, green: 0.15, blue: 0.15).opacity(0.28)
    static let legalCapture = Color(red: 0.85, green: 0.2, blue: 0.15).opacity(0.55)
    static let selectedRing = Color(red: 0.98, green: 0.75, blue: 0.18).opacity(0.95)
    static let check = Color.red.opacity(0.45)
    static let background = Color(red: 0.12, green: 0.12, blue: 0.14)
    static let accent = Color(red: 0.98, green: 0.75, blue: 0.18)
}

extension Piece {
    var assetName: String {
        let prefix = color == .white ? "w" : "b"
        let suffix: String
        switch kind {
        case .king: suffix = "K"
        case .queen: suffix = "Q"
        case .rook: suffix = "R"
        case .bishop: suffix = "B"
        case .knight: suffix = "N"
        case .pawn: suffix = "P"
        }
        return "\(prefix)\(suffix)"
    }
}
