import Foundation

enum UCIParser {
    /// Parse a Fairy-Stockfish UCI move on the 10×10 grid (files a–j, ranks 1–10).
    static func parseEngineMove(_ uci: String) -> (from: Square, to: Square, promotion: PieceKind?)? {
        let trimmed = uci.trimmingCharacters(in: .whitespaces).lowercased()
        guard trimmed.count >= 4 else { return nil }

        var index = trimmed.startIndex
        guard let from = parseEngineSquare(in: trimmed, at: &index),
              let to = parseEngineSquare(in: trimmed, at: &index) else {
            return nil
        }

        let promotion: PieceKind?
        if index < trimmed.endIndex {
            let ch = trimmed[index]
            promotion = PieceKind(rawValue: Character(String(ch).uppercased()))
        } else {
            promotion = nil
        }

        return (from, to, promotion)
    }

    private static func parseEngineSquare(in text: String, at index: inout String.Index) -> Square? {
        guard index < text.endIndex else { return nil }
        let file = text[index]
        guard file >= "a", file <= "j" else { return nil }
        index = text.index(after: index)

        guard index < text.endIndex else { return nil }
        var rankEnd = text.index(after: index)
        if text[index] == "1", rankEnd < text.endIndex, text[rankEnd] == "0" {
            rankEnd = text.index(after: rankEnd)
        }
        let rankText = String(text[index..<rankEnd])
        guard let rank = Int(rankText), (1...BoardConstants.size).contains(rank) else { return nil }
        index = rankEnd

        let col = Int(file.asciiValue! - 97)
        let row = BoardConstants.size - rank
        let square = Square(row: row, col: col)
        return square.isValid ? square : nil
    }
}
