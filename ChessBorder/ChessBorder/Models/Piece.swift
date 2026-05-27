import Foundation

enum PieceColor: CaseIterable, Codable {
    case white
    case black

    var opposite: PieceColor {
        self == .white ? .black : .white
    }
}

enum PieceKind: Character, CaseIterable, Codable, Hashable {
    case king = "K"
    case queen = "Q"
    case rook = "R"
    case bishop = "B"
    case knight = "N"
    case pawn = "P"

    var value: Int {
        switch self {
        case .pawn: 100
        case .knight, .bishop: 320
        case .rook: 500
        case .queen: 900
        case .king: 20_000
        }
    }
}

struct Piece: Equatable, Codable {
    let kind: PieceKind
    let color: PieceColor
}

struct Square: Hashable, Codable {
    let row: Int
    let col: Int

    var isValid: Bool {
        (0..<BoardConstants.size).contains(row) && (0..<BoardConstants.size).contains(col)
    }

    var isPlayable: Bool {
        BoardConstants.isPlayable(row: row, col: col)
    }

    /// User-facing and UCI notation: standard a–h / 1–8 on the inner board.
    var notation: String {
        guard isPlayable else { return engineNotation }
        let file = Character(UnicodeScalar(col - 1 + 97)!)
        return "\(file)\(9 - row)"
    }

    /// Full 10×10 coordinates for Fairy-Stockfish FEN and engine UCI.
    var engineNotation: String {
        let file = Character(UnicodeScalar(col + 97)!)
        return "\(file)\(BoardConstants.size - row)"
    }

    /// Parse standard chess square (a1–h8) on the inner 8×8.
    static func fromStandardNotation(_ text: String) -> Square? {
        let trimmed = text.lowercased()
        guard trimmed.count == 2,
              let file = trimmed.first,
              let rank = Int(String(trimmed.last!)),
              rank >= 1, rank <= 8 else { return nil }
        let fileIndex = Int(file.asciiValue! - 97)
        guard (0...7).contains(fileIndex) else { return nil }
        let sq = Square(row: 9 - rank, col: fileIndex + 1)
        return sq.isPlayable ? sq : nil
    }

    /// Parse 10×10 engine square (a1–j10), including border cells.
    static func fromEngineNotation(_ text: String) -> Square? {
        let trimmed = text.lowercased()
        guard trimmed.count == 2,
              let file = trimmed.first,
              let rank = Int(String(trimmed.last!)),
              rank >= 1, rank <= BoardConstants.size else { return nil }
        let col = Int(file.asciiValue! - 97)
        let row = BoardConstants.size - rank
        let sq = Square(row: row, col: col)
        return sq.isValid ? sq : nil
    }
}

enum BoardConstants {
    static let size = 10
    static let playableRange = 1...8

    static func isPlayable(row: Int, col: Int) -> Bool {
        playableRange.contains(row) && playableRange.contains(col)
    }

    static func isBorder(row: Int, col: Int) -> Bool {
        !isPlayable(row: row, col: col)
    }

    /// Standard chess file label (a–h) for the inner 8×8; nil on border columns.
    static func standardFileLabel(col: Int) -> String? {
        guard playableRange.contains(col) else { return nil }
        return String(Character(UnicodeScalar(col - 1 + 97)!))
    }

    /// Standard chess rank label (1–8) for the inner 8×8; nil on border rows.
    static func standardRankLabel(row: Int) -> String? {
        guard playableRange.contains(row) else { return nil }
        return String(9 - row)
    }
}
