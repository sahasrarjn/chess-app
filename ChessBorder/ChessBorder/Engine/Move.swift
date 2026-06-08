import Foundation

struct Move: Equatable, Hashable {
    let from: Square
    let to: Square
    let promotion: PieceKind?
    let isCastle: Bool
    let isEnPassant: Bool

    init(from: Square, to: Square, promotion: PieceKind? = nil, isCastle: Bool = false, isEnPassant: Bool = false) {
        self.from = from
        self.to = to
        self.promotion = promotion
        self.isCastle = isCastle
        self.isEnPassant = isEnPassant
    }

    var uci: String {
        // Use engine notation for both squares when either touches the border ring.
        // Mixed notation (standard from + engine to) produces strings like "e4f10"
        // that the server cannot correctly round-trip.
        let encode: (Square) -> String = (!from.isPlayable || !to.isPlayable)
            ? { $0.engineNotation }
            : { $0.notation }
        var text = "\(encode(from))\(encode(to))"
        if let promotion {
            text += String(promotion.rawValue).lowercased()
        }
        return text
    }
}

struct CastlingRights: Equatable, Codable {
    var whiteKingSide: Bool
    var whiteQueenSide: Bool
    var blackKingSide: Bool
    var blackQueenSide: Bool

    static let all = CastlingRights(
        whiteKingSide: true,
        whiteQueenSide: true,
        blackKingSide: true,
        blackQueenSide: true
    )

    func canCastle(color: PieceColor, kingSide: Bool) -> Bool {
        switch color {
        case .white: kingSide ? whiteKingSide : whiteQueenSide
        case .black: kingSide ? blackKingSide : blackQueenSide
        }
    }

    mutating func revoke(color: PieceColor, kingSide: Bool? = nil) {
        switch color {
        case .white:
            if kingSide == nil { whiteKingSide = false; whiteQueenSide = false }
            else if kingSide == true { whiteKingSide = false }
            else { whiteQueenSide = false }
        case .black:
            if kingSide == nil { blackKingSide = false; blackQueenSide = false }
            else if kingSide == true { blackKingSide = false }
            else { blackQueenSide = false }
        }
    }
}
