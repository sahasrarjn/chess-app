import Foundation

enum MoveNotation {
    static func san(for move: Move, in game: ChessGame) -> String {
        if move.isCastle {
            return move.to.col > move.from.col ? "O-O" : "O-O-O"
        }

        guard let piece = game.piece(at: move.from) else { return move.uci }

        var san: String
        let isCapture = game.piece(at: move.to) != nil || move.isEnPassant

        if piece.kind == .pawn {
            if isCapture {
                san = "\(fileLetter(move.from.col))x\(move.to.notation)"
            } else {
                san = move.to.notation
            }
            if let promotion = move.promotion {
                san += "=\(promotion.rawValue)"
            }
        } else {
            san = disambiguation(for: move, piece: piece, in: game)
            san += String(piece.kind.rawValue)
            if isCapture { san += "x" }
            san += move.to.notation
        }

        let copy = game.copy()
        copy.applyMoveUnchecked(move, recordHistory: false)

        switch copy.result {
        case .checkmate:
            san += "#"
        case .ongoing where copy.isInCheck(color: copy.activeColor):
            san += "+"
        default:
            break
        }

        return san
    }

    private static func fileLetter(_ col: Int) -> String {
        String(Character(UnicodeScalar(col - 1 + 97)!))
    }

    private static func disambiguation(for move: Move, piece: Piece, in game: ChessGame) -> String {
        let others = game.legalMoves(for: game.activeColor).filter {
            guard $0.to == move.to, $0.from != move.from else { return false }
            guard let p = game.piece(at: $0.from) else { return false }
            return p.kind == piece.kind && p.color == piece.color
        }

        guard !others.isEmpty else { return "" }

        let sameFile = others.contains { $0.from.col == move.from.col }
        let sameRank = others.contains { $0.from.row == move.from.row }

        if !sameFile {
            return fileLetter(move.from.col)
        }
        if !sameRank {
            return "\(9 - move.from.row)"
        }
        return move.from.notation
    }
}

struct GameSnapshot: Equatable {
    let board: [[Piece?]]
    let activeColor: PieceColor
    let castlingRights: CastlingRights
    let enPassantTarget: Square?
    let halfmoveClock: Int
    let fullmoveNumber: Int
    let lastMove: Move?

    init(from game: ChessGame) {
        board = game.board.map { $0.map { $0 } }
        activeColor = game.activeColor
        castlingRights = game.castlingRights
        enPassantTarget = game.enPassantTarget
        halfmoveClock = game.halfmoveClock
        fullmoveNumber = game.fullmoveNumber
        lastMove = game.lastMove
    }

    func piece(at square: Square) -> Piece? {
        guard square.isValid else { return nil }
        return board[square.row][square.col]
    }
}

struct RecordedMove: Identifiable, Equatable {
    let id: Int
    let ply: Int
    let san: String
    let color: PieceColor
    let move: Move
    let captured: Piece?

    var moveNumberText: String? {
        color == .white ? "\((ply / 2) + 1)." : nil
    }
}
