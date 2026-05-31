import Foundation

extension ChessGame {
    /// FEN for Fairy-Stockfish (10×10 border chess, ranks 10→1 top to bottom).
    func toFEN() -> String {
        var ranks: [String] = []
        for row in 0..<BoardConstants.size {
            ranks.append(fenRank(row: row))
        }
        let placement = ranks.joined(separator: "/")
        let side = activeColor == .white ? "w" : "b"
        let castle = fenCastling()
        let ep = enPassantTarget?.engineNotation ?? "-"
        return "\(placement) \(side) \(castle) \(ep) \(halfmoveClock) \(fullmoveNumber)"
    }

    private func fenRank(row: Int) -> String {
        var result = ""
        var empty = 0
        for col in 0..<BoardConstants.size {
            if let piece = board[row][col] {
                if empty > 0 {
                    result += fenEmptyRun(empty)
                    empty = 0
                }
                result += fenCharacter(for: piece)
            } else {
                empty += 1
            }
        }
        if empty > 0 {
            result += fenEmptyRun(empty)
        }
        return result
    }

    /// Run-length `10` is invalid for API/engine FEN (digit 0); use dots like variants.ini.
    private func fenEmptyRun(_ count: Int) -> String {
        count >= BoardConstants.size
            ? String(repeating: ".", count: count)
            : String(count)
    }

    private func fenCharacter(for piece: Piece) -> String {
        let ch = String(piece.kind.rawValue)
        return piece.color == .white ? ch : ch.lowercased()
    }

    private func fenCastling() -> String {
        var s = ""
        if castlingRights.whiteKingSide { s += "K" }
        if castlingRights.whiteQueenSide { s += "Q" }
        if castlingRights.blackKingSide { s += "k" }
        if castlingRights.blackQueenSide { s += "q" }
        return s.isEmpty ? "-" : s
    }

    /// Parse standard UCI (e2e4) for human/bot moves on the inner 8×8.
    func move(from uci: String) -> Move? {
        matchMove(uci: uci, preferEngineCoordinates: false)
    }

    /// Parse Fairy-Stockfish UCI (10×10 files a–j, ranks 1–10).
    func move(fromEngineUCI uci: String) -> Move? {
        matchMove(uci: uci, preferEngineCoordinates: true)
    }

    private func matchMove(uci: String, preferEngineCoordinates: Bool) -> Move? {
        let trimmed = uci.trimmingCharacters(in: .whitespaces).lowercased()

        var candidates: [(Square, Square, PieceKind?)] = []

        if preferEngineCoordinates, let parsed = UCIParser.parseEngineMove(trimmed) {
            candidates.append((parsed.from, parsed.to, parsed.promotion))
        }

        if trimmed.count >= 4 {
            let fromStr = String(trimmed.prefix(2))
            let toStr = String(trimmed.dropFirst(2).prefix(2))
            let promoChar = trimmed.count > 4 ? trimmed.last! : nil
            let promotion = promoChar.flatMap { ch in
                PieceKind(rawValue: Character(String(ch).uppercased()))
            }
            if let from = Square.fromStandardNotation(fromStr), let to = Square.fromStandardNotation(toStr) {
                candidates.append((from, to, promotion))
            }
            let fromMix = Square.fromStandardNotation(fromStr) ?? Square.fromEngineNotation(fromStr)
            let toMix = Square.fromStandardNotation(toStr) ?? Square.fromEngineNotation(toStr)
            if let fromMix, let toMix {
                candidates.append((fromMix, toMix, promotion))
            }
        }

        var seen = Set<String>()
        for (from, to, promotion) in candidates {
            let key = "\(from.row),\(from.col),\(to.row),\(to.col),\(promotion?.rawValue ?? "")"
            if seen.contains(key) { continue }
            seen.insert(key)

            let strict = legalMoves(for: activeColor).filter {
                $0.from == from && $0.to == to && $0.promotion == promotion
            }
            if let move = strict.first { return move }
            if let move = legalMoves(for: activeColor).first(where: { $0.from == from && $0.to == to }) {
                return move
            }
        }
        return nil
    }
}
