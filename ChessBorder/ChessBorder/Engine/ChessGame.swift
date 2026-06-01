import Foundation

final class ChessGame {
    private(set) var board: [[Piece?]]
    private(set) var activeColor: PieceColor
    private(set) var castlingRights: CastlingRights
    private(set) var enPassantTarget: Square?
    private(set) var halfmoveClock: Int
    private(set) var fullmoveNumber: Int
    private(set) var moveHistory: [UndoRecord] = []
    private(set) var recordedMoves: [RecordedMove] = []
    private(set) var snapshots: [GameSnapshot] = []
    private(set) var lastMove: Move?
    private(set) var resignedBy: PieceColor?
    private var positionCounts: [String: Int] = [:]

    struct UndoRecord {
        let move: Move
        let captured: Piece?
        let enPassantCaptured: Piece?
        let previousCastling: CastlingRights
        let previousEnPassant: Square?
        let previousHalfmove: Int
        let previousFullmove: Int
        let previousActiveColor: PieceColor
        let rookFrom: Square?
        let rookTo: Square?
    }

    init() {
        board = Self.startingBoard()
        activeColor = .white
        castlingRights = .all
        enPassantTarget = nil
        halfmoveClock = 0
        fullmoveNumber = 1
        snapshots = [GameSnapshot(from: self)]
        registerPosition()
    }

    /// Clear move history after FEN import (mirrors web `resetLoadedPosition`).
    func resetLoadedPosition() {
        moveHistory = []
        recordedMoves = []
        lastMove = nil
        snapshots = [GameSnapshot(from: self)]
        positionCounts = [:]
        registerPosition()
    }

    /// Load a Fairy-Stockfish chessborder FEN (mirrors web `fromFEN`).
    static func fromFEN(_ fen: String) throws -> ChessGame {
        let parts = fen.trimmingCharacters(in: .whitespaces).split(whereSeparator: \.isWhitespace).map(String.init)
        guard parts.count >= 4 else { throw FENError.invalid }

        let ranks = parts[0].split(separator: "/").map(String.init)
        guard ranks.count == BoardConstants.size else { throw FENError.invalid }

        let game = ChessGame()
        for row in 0..<BoardConstants.size {
            try game.parseFenRank(ranks[row], row: row)
        }

        game.activeColor = parts[1] == "b" ? .black : .white
        game.castlingRights = game.parseCastling(parts[2])
        game.enPassantTarget = game.parseEnPassant(parts[3])
        game.halfmoveClock = parts.count > 4 ? Int(parts[4]) ?? 0 : 0
        game.fullmoveNumber = parts.count > 5 ? Int(parts[5]) ?? 1 : 1
        game.resetLoadedPosition()
        return game
    }

    private func parseFenRank(_ rankStr: String, row: Int) throws {
        var col = 0
        for ch in rankStr {
            if col >= BoardConstants.size { break }
            if ch == "." {
                board[row][col] = nil
                col += 1
                continue
            }
            if ch.isNumber, let empty = ch.wholeNumberValue, empty > 0 {
                for _ in 0..<empty where col < BoardConstants.size {
                    board[row][col] = nil
                    col += 1
                }
                continue
            }
            let upper = Character(String(ch).uppercased())
            guard let kind = PieceKind(rawValue: upper) else { throw FENError.invalid }
            let color: PieceColor = ch.isUppercase ? .white : .black
            board[row][col] = Piece(kind: kind, color: color)
            col += 1
        }
        while col < BoardConstants.size {
            board[row][col] = nil
            col += 1
        }
    }

    private func parseCastling(_ text: String) -> CastlingRights {
        if text == "-" {
            return CastlingRights(
                whiteKingSide: false, whiteQueenSide: false,
                blackKingSide: false, blackQueenSide: false
            )
        }
        return CastlingRights(
            whiteKingSide: text.contains("K"),
            whiteQueenSide: text.contains("Q"),
            blackKingSide: text.contains("k"),
            blackQueenSide: text.contains("q")
        )
    }

    private func parseEnPassant(_ text: String) -> Square? {
        if text == "-" { return nil }
        return Square.fromEngineNotation(text) ?? Square.fromStandardNotation(text)
    }

    // MARK: - Starting position

    static func startingBoard() -> [[Piece?]] {
        var b = Array(repeating: Array(repeating: Piece?.none, count: size), count: size)

        let whiteBack = 8, whitePawns = 7
        let blackBack = 1, blackPawns = 2

        let backRank: [PieceKind] = [.rook, .knight, .bishop, .queen, .king, .bishop, .knight, .rook]
        for (i, kind) in backRank.enumerated() {
            b[whiteBack][i + 1] = Piece(kind: kind, color: .white)
            b[blackBack][i + 1] = Piece(kind: kind, color: .black)
        }
        for col in 1...8 {
            b[whitePawns][col] = Piece(kind: .pawn, color: .white)
            b[blackPawns][col] = Piece(kind: .pawn, color: .black)
        }
        return b
    }

    private static var size: Int { BoardConstants.size }

    func piece(at square: Square) -> Piece? {
        guard square.isValid else { return nil }
        return board[square.row][square.col]
    }

    // MARK: - Game state

    var result: GameResult {
        if let resignedBy {
            return .resignation(winner: resignedBy.opposite)
        }
        if isInsufficientMaterial {
            return .draw(reason: "insufficient material")
        }
        if isThreefoldRepetition {
            return .draw(reason: "threefold repetition")
        }

        let moves = legalMoves(for: activeColor)
        if moves.isEmpty {
            if isInCheck(color: activeColor) {
                return .checkmate(winner: activeColor.opposite)
            }
            return .stalemate
        }
        if halfmoveClock >= 100 {
            return .draw(reason: "50-move rule")
        }
        return .ongoing
    }

    var isThreefoldRepetition: Bool {
        positionCounts[positionKey(), default: 0] >= 3
    }

    var isInsufficientMaterial: Bool {
        var white: [PieceKind] = []
        var black: [PieceKind] = []
        for row in board {
            for cell in row {
                guard let piece = cell, piece.kind != .king else { continue }
                if piece.color == .white { white.append(piece.kind) }
                else { black.append(piece.kind) }
            }
        }

        if white.isEmpty && black.isEmpty { return true }

        let minors: Set<PieceKind> = [.bishop, .knight]
        if white.allSatisfy({ minors.contains($0) }) && black.isEmpty { return white.count <= 1 }
        if black.allSatisfy({ minors.contains($0) }) && white.isEmpty { return black.count <= 1 }
        if white.count == 1, black.count == 1,
           white[0] != .pawn, white[0] != .queen, white[0] != .rook,
           black[0] != .pawn, black[0] != .queen, black[0] != .rook {
            return true
        }
        return false
    }

    func snapshot(atPly ply: Int) -> GameSnapshot {
        snapshots[min(max(ply, 0), snapshots.count - 1)]
    }

    func resign(by color: PieceColor) {
        resignedBy = color
    }

    func isInCheck(color: PieceColor) -> Bool {
        guard let kingSquare = findKing(color: color) else { return false }
        return isSquareAttacked(kingSquare, by: color.opposite)
    }

    func findKing(color: PieceColor) -> Square? {
        for row in 0..<Self.size {
            for col in 0..<Self.size {
                if let p = board[row][col], p.kind == .king, p.color == color {
                    return Square(row: row, col: col)
                }
            }
        }
        return nil
    }

    // MARK: - Move generation

    func legalMoves(for color: PieceColor? = nil) -> [Move] {
        let color = color ?? activeColor
        var moves: [Move] = []
        for row in 0..<Self.size {
            for col in 0..<Self.size {
                let sq = Square(row: row, col: col)
                if let piece = board[row][col], piece.color == color {
                    moves.append(contentsOf: pseudoLegalMoves(from: sq, piece: piece))
                }
            }
        }
        return moves.filter { !wouldLeaveKingInCheck($0, color: color) }
    }

    private func pseudoLegalMoves(from square: Square, piece: Piece) -> [Move] {
        switch piece.kind {
        case .pawn: return pawnMoves(from: square, color: piece.color)
        case .knight: return knightMoves(from: square, color: piece.color)
        case .bishop: return slidingMoves(from: square, color: piece.color, directions: bishopDirs)
        case .rook: return slidingMoves(from: square, color: piece.color, directions: rookDirs)
        case .queen: return slidingMoves(from: square, color: piece.color, directions: bishopDirs + rookDirs)
        case .king: return kingMoves(from: square, color: piece.color)
        }
    }

    private let bishopDirs = [(-1, -1), (-1, 1), (1, -1), (1, 1)]
    private let rookDirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]

    private func forwardDelta(for color: PieceColor) -> Int {
        color == .white ? -1 : 1
    }

    private func pawnStartRow(for color: PieceColor) -> Int {
        color == .white ? 7 : 2
    }

    private func promotionRow(for color: PieceColor) -> Int {
        color == .white ? 0 : BoardConstants.size - 1
    }

    private func isPawnDestination(_ square: Square, color: PieceColor) -> Bool {
        guard square.isValid else { return false }
        if square.isPlayable { return true }
        return square.row == promotionRow(for: color)
            && BoardConstants.playableRange.contains(square.col)
    }

    private func pawnMoves(from square: Square, color: PieceColor) -> [Move] {
        var moves: [Move] = []
        let dir = forwardDelta(for: color)
        let oneForward = Square(row: square.row + dir, col: square.col)

        if isPawnDestination(oneForward, color: color), board[oneForward.row][oneForward.col] == nil {
            if oneForward.row == promotionRow(for: color) {
                for kind in [PieceKind.queen, .rook, .bishop, .knight] {
                    moves.append(Move(from: square, to: oneForward, promotion: kind))
                }
            } else {
                moves.append(Move(from: square, to: oneForward))
            }

            if square.row == pawnStartRow(for: color) {
                let twoForward = Square(row: square.row + 2 * dir, col: square.col)
                if twoForward.isValid, twoForward.isPlayable, board[twoForward.row][twoForward.col] == nil {
                    moves.append(Move(from: square, to: twoForward))
                }
            }
        }

        for dc in [-1, 1] {
            let capture = Square(row: square.row + dir, col: square.col + dc)
            // A pawn may capture diagonally onto a border square: enemy pieces can
            // slide onto the outer ring, and a diagonally adjacent pawn must be able
            // to take them. Unlike forward moves, captures aren't limited to playable
            // squares (isPawnDestination); any on-board square with an enemy is fair.
            guard capture.isValid else { continue }

            if let target = board[capture.row][capture.col], target.color != color {
                if capture.row == promotionRow(for: color) {
                    for kind in [PieceKind.queen, .rook, .bishop, .knight] {
                        moves.append(Move(from: square, to: capture, promotion: kind))
                    }
                } else {
                    moves.append(Move(from: square, to: capture))
                }
            } else if let ep = enPassantTarget, ep == capture {
                if capture.row == promotionRow(for: color) {
                    for kind in [PieceKind.queen, .rook, .bishop, .knight] {
                        moves.append(Move(from: square, to: capture, promotion: kind, isEnPassant: true))
                    }
                } else {
                    moves.append(Move(from: square, to: capture, isEnPassant: true))
                }
            }
        }
        return moves
    }

    private func knightMoves(from square: Square, color: PieceColor) -> [Move] {
        let offsets = [(-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1)]
        return offsets.compactMap { dr, dc in
            let to = Square(row: square.row + dr, col: square.col + dc)
            guard to.isValid, canMoveTo(to, color: color) else { return nil }
            return Move(from: square, to: to)
        }
    }

    private func slidingMoves(from square: Square, color: PieceColor, directions: [(Int, Int)]) -> [Move] {
        var moves: [Move] = []
        for (dr, dc) in directions {
            var r = square.row + dr
            var c = square.col + dc
            while (0..<Self.size).contains(r), (0..<Self.size).contains(c) {
                let to = Square(row: r, col: c)
                if let target = board[r][c] {
                    if target.color != color {
                        moves.append(Move(from: square, to: to))
                    }
                    break
                }
                moves.append(Move(from: square, to: to))
                if square.isPlayable && BoardConstants.isBorder(row: to.row, col: to.col) {
                    break
                }
                r += dr
                c += dc
            }
        }
        return moves
    }

    private func kingMoves(from square: Square, color: PieceColor) -> [Move] {
        var moves: [Move] = []
        for dr in -1...1 {
            for dc in -1...1 where dr != 0 || dc != 0 {
                let to = Square(row: square.row + dr, col: square.col + dc)
                if to.isValid, canMoveTo(to, color: color) {
                    moves.append(Move(from: square, to: to))
                }
            }
        }
        if square.isPlayable {
            moves.append(contentsOf: castlingMoves(for: color, kingSquare: square))
        }
        return moves
    }

    private func castlingMoves(for color: PieceColor, kingSquare: Square) -> [Move] {
        var moves: [Move] = []
        let row = color == .white ? 8 : 1

        if castlingRights.canCastle(color: color, kingSide: true) {
            let f = Square(row: row, col: 6)
            let g = Square(row: row, col: 7)
            let rook = Square(row: row, col: 8)
            if canCastle(color: color, king: kingSquare, through: [f, g], rook: rook) {
                moves.append(Move(from: kingSquare, to: g, isCastle: true))
            }
        }

        if castlingRights.canCastle(color: color, kingSide: false) {
            let d = Square(row: row, col: 4)
            let c = Square(row: row, col: 3)
            let b = Square(row: row, col: 2)
            let rook = Square(row: row, col: 1)
            if canCastle(color: color, king: kingSquare, through: [d, c, b], rook: rook) {
                moves.append(Move(from: kingSquare, to: c, isCastle: true))
            }
        }
        return moves
    }

    private func canCastle(color: PieceColor, king: Square, through squares: [Square], rook: Square) -> Bool {
        guard king.row == (color == .white ? 8 : 1), king.col == 5 else { return false }
        guard board[rook.row][rook.col]?.kind == .rook,
              board[rook.row][rook.col]?.color == color else { return false }

        for sq in squares {
            if board[sq.row][sq.col] != nil { return false }
            if isSquareAttacked(sq, by: color.opposite) { return false }
        }
        if isSquareAttacked(king, by: color.opposite) { return false }
        return true
    }

    private func canMoveTo(_ square: Square, color: PieceColor) -> Bool {
        guard square.isValid else { return false }
        guard let target = board[square.row][square.col] else { return true }
        return target.color != color
    }

    func isSquareAttacked(_ square: Square, by color: PieceColor) -> Bool {
        guard square.isValid else { return false }

        // Pawn attacks
        let pawnDir = forwardDelta(for: color.opposite)
        for dc in [-1, 1] {
            let r = square.row + pawnDir
            let c = square.col + dc
            let from = Square(row: r, col: c)
            if from.isValid,
               let p = board[r][c], p.kind == .pawn, p.color == color {
                return true
            }
        }

        // Knight attacks
        let knightOffsets = [(-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1)]
        for (dr, dc) in knightOffsets {
            let r = square.row + dr, c = square.col + dc
            let from = Square(row: r, col: c)
            if from.isValid,
               let p = board[r][c], p.kind == .knight, p.color == color {
                return true
            }
        }

        // King attacks
        for dr in -1...1 {
            for dc in -1...1 where dr != 0 || dc != 0 {
                let r = square.row + dr, c = square.col + dc
                let from = Square(row: r, col: c)
                if from.isValid,
                   let p = board[r][c], p.kind == .king, p.color == color {
                    return true
                }
            }
        }

        // Sliding pieces - border squares are valid stepping stones, not walls
        for (dr, dc) in bishopDirs {
            if rayAttacks(from: square, dr: dr, dc: dc, color: color, rook: false) { return true }
        }
        for (dr, dc) in rookDirs {
            if rayAttacks(from: square, dr: dr, dc: dc, color: color, rook: true) { return true }
        }
        return false
    }

    private func rayAttacks(from square: Square, dr: Int, dc: Int, color: PieceColor, rook: Bool) -> Bool {
        var r = square.row + dr
        var c = square.col + dc
        while (0..<Self.size).contains(r), (0..<Self.size).contains(c) {
            if let p = board[r][c] {
                if p.color == color {
                    if rook && (p.kind == .rook || p.kind == .queen) { return true }
                    if !rook && (p.kind == .bishop || p.kind == .queen) { return true }
                }
                return false
            }
            r += dr
            c += dc
        }
        return false
    }

    private func wouldLeaveKingInCheck(_ move: Move, color: PieceColor) -> Bool {
        let copy = ChessGame()
        copy.board = board
        copy.activeColor = activeColor
        copy.castlingRights = castlingRights
        copy.enPassantTarget = enPassantTarget
        copy.halfmoveClock = halfmoveClock
        copy.fullmoveNumber = fullmoveNumber
        copy.applyMoveUnchecked(move, recordHistory: false)
        return copy.isInCheck(color: color)
    }

    // MARK: - Applying moves

    @discardableResult
    func applyMove(_ move: Move) -> Bool {
        guard move.to.isValid else { return false }
        let legal = legalMoves(for: activeColor)
        guard legal.contains(where: { $0.from == move.from && $0.to == move.to && $0.promotion == move.promotion }) else {
            return false
        }
        applyMoveUnchecked(move, recordHistory: true)
        return true
    }

    func applyMoveUnchecked(_ move: Move, recordHistory: Bool = true) {
        let san = recordHistory ? MoveNotation.san(for: move, in: self) : nil
        let moving = board[move.from.row][move.from.col]!
        let movingColor = activeColor
        var captured: Piece? = board[move.to.row][move.to.col]
        var enPassantCaptured: Piece?
        var rookFrom: Square?
        var rookTo: Square?

        if move.isEnPassant {
            let capRow = move.from.row
            let capCol = move.to.col
            enPassantCaptured = board[capRow][capCol]
            board[capRow][capCol] = nil
            captured = enPassantCaptured
        }

        board[move.to.row][move.to.col] = moving
        board[move.from.row][move.from.col] = nil

        if move.isCastle {
            let row = move.from.row
            if move.to.col == 7 {
                rookFrom = Square(row: row, col: 8)
                rookTo = Square(row: row, col: 6)
            } else {
                rookFrom = Square(row: row, col: 1)
                rookTo = Square(row: row, col: 4)
            }
            board[rookTo!.row][rookTo!.col] = board[rookFrom!.row][rookFrom!.col]
            board[rookFrom!.row][rookFrom!.col] = nil
        }

        if let promotion = move.promotion {
            board[move.to.row][move.to.col] = Piece(kind: promotion, color: moving.color)
        }

        updateCastlingRights(after: move, piece: moving, captured: captured)
        updateEnPassant(after: move, piece: moving)

        if moving.kind == .pawn || captured != nil {
            halfmoveClock = 0
        } else {
            halfmoveClock += 1
        }

        if activeColor == .black {
            fullmoveNumber += 1
        }

        let record = UndoRecord(
            move: move,
            captured: captured,
            enPassantCaptured: enPassantCaptured,
            previousCastling: castlingRights,
            previousEnPassant: enPassantTarget,
            previousHalfmove: halfmoveClock - (moving.kind == .pawn || captured != nil ? 0 : 1),
            previousFullmove: fullmoveNumber,
            previousActiveColor: activeColor,
            rookFrom: rookFrom,
            rookTo: rookTo
        )

        lastMove = move
        activeColor = activeColor.opposite

        if recordHistory {
            moveHistory.append(record)

            let ply = recordedMoves.count
            recordedMoves.append(
                RecordedMove(
                    id: ply,
                    ply: ply,
                    san: san ?? move.uci,
                    color: movingColor,
                    move: move,
                    captured: captured ?? enPassantCaptured
                )
            )
            snapshots.append(GameSnapshot(from: self))
            registerPosition()
        }
    }

    private func unregisterPosition() {
        let key = positionKey()
        if let count = positionCounts[key], count > 1 {
            positionCounts[key] = count - 1
        } else {
            positionCounts.removeValue(forKey: key)
        }
    }

    private func registerPosition() {
        let key = positionKey()
        positionCounts[key, default: 0] += 1
    }

    private func positionKey() -> String {
        var parts: [String] = [activeColor == .white ? "w" : "b"]
        for row in board {
            for cell in row {
                if let piece = cell {
                    parts.append("\(piece.color == .white ? "w" : "b")\(piece.kind.rawValue)")
                } else {
                    parts.append(".")
                }
            }
        }
        parts.append(castlingRightsDescription)
        if let ep = enPassantTarget {
            parts.append(ep.notation)
        }
        return parts.joined(separator: "|")
    }

    private var castlingRightsDescription: String {
        var text = ""
        if castlingRights.whiteKingSide { text += "K" }
        if castlingRights.whiteQueenSide { text += "Q" }
        if castlingRights.blackKingSide { text += "k" }
        if castlingRights.blackQueenSide { text += "q" }
        return text
    }

    private func updateCastlingRights(after move: Move, piece: Piece, captured: Piece?) {
        if piece.kind == .king {
            castlingRights.revoke(color: piece.color)
        }
        if piece.kind == .rook {
            let row = piece.color == .white ? 8 : 1
            if move.from == Square(row: row, col: 1) {
                castlingRights.revoke(color: piece.color, kingSide: false)
            }
            if move.from == Square(row: row, col: 8) {
                castlingRights.revoke(color: piece.color, kingSide: true)
            }
        }
        if let captured, captured.kind == .rook {
            let row = captured.color == .white ? 8 : 1
            if move.to == Square(row: row, col: 1) {
                castlingRights.revoke(color: captured.color, kingSide: false)
            }
            if move.to == Square(row: row, col: 8) {
                castlingRights.revoke(color: captured.color, kingSide: true)
            }
        }
    }

    private func updateEnPassant(after move: Move, piece: Piece) {
        enPassantTarget = nil
        if piece.kind == .pawn, abs(move.to.row - move.from.row) == 2 {
            let dir = forwardDelta(for: piece.color)
            enPassantTarget = Square(row: move.from.row + dir, col: move.from.col)
        }
    }

    func undoLastMove() -> Bool {
        guard let record = moveHistory.popLast() else { return false }

        unregisterPosition()
        if !snapshots.isEmpty { snapshots.removeLast() }
        if !recordedMoves.isEmpty { recordedMoves.removeLast() }

        activeColor = record.previousActiveColor
        castlingRights = record.previousCastling
        enPassantTarget = record.previousEnPassant
        halfmoveClock = record.previousHalfmove
        fullmoveNumber = record.previousFullmove

        let move = record.move
        let piece = board[move.to.row][move.to.col]!

        board[move.from.row][move.from.col] = Piece(kind: piece.kind == .pawn && move.promotion != nil ? .pawn : piece.kind, color: piece.color)
        board[move.to.row][move.to.col] = record.captured

        if move.isEnPassant, let ep = record.enPassantCaptured {
            board[move.from.row][move.to.col] = ep
        }

        if let rookFrom = record.rookFrom, let rookTo = record.rookTo {
            board[rookFrom.row][rookFrom.col] = board[rookTo.row][rookTo.col]
            board[rookTo.row][rookTo.col] = nil
        }

        lastMove = moveHistory.last?.move
        return true
    }

    // MARK: - Evaluation helpers

    func materialScore(for color: PieceColor) -> Int {
        var score = 0
        for row in board {
            for cell in row {
                guard let p = cell else { continue }
                let v = p.kind.value
                score += p.color == color ? v : -v
            }
        }
        return score
    }

    func copy() -> ChessGame {
        let g = ChessGame()
        g.board = board
        g.activeColor = activeColor
        g.castlingRights = castlingRights
        g.enPassantTarget = enPassantTarget
        g.halfmoveClock = halfmoveClock
        g.fullmoveNumber = fullmoveNumber
        g.lastMove = lastMove
        return g
    }
}

extension Move {
    func matchesSelection(from: Square, to: Square) -> Bool {
        self.from == from && self.to == to
    }
}
