import Foundation

struct ExplainInput {
    let fen: String
    let movePlayed: String
    let bestMoveUci: String?
    let pv: [String]
    let before: PositionEval
    let after: PositionEval
    let classification: MoveClassification
    let mover: PieceColor
}

func pieceName(_ kind: PieceKind) -> String {
    switch kind {
    case .queen: return "queen"
    case .rook: return "rook"
    case .bishop: return "bishop"
    case .knight: return "knight"
    case .pawn: return "pawn"
    case .king: return "king"
    }
}

// MARK: - Attacker/defender counting

/// Count the number of attackers a side has on a square.
/// Pawn pushes (same file) are excluded — only pawn captures count.
private func countAttackers(
    game: ChessGame,
    square: Square,
    attackerColor: PieceColor
) -> (count: Int, minValue: Int) {
    let moves = game.legalMoves(for: attackerColor)
    var count = 0
    var minValue = Int.max
    for m in moves {
        guard m.to == square else { continue }
        guard let piece = game.piece(at: m.from) else { continue }
        // Skip pawn pushes
        if piece.kind == .pawn && m.from.col == m.to.col { continue }
        count += 1
        let v = piece.kind.value
        if v < minValue { minValue = v }
    }
    return (count: count, minValue: minValue == Int.max ? 0 : minValue)
}

/// Count how many mover-colored pieces can recapture on a square.
/// Temporarily places an opponent piece on the square to enable legal captures.
private func countDefenders(
    game: ChessGame,
    square: Square,
    moverColor: PieceColor,
    pieceKind: PieceKind
) -> Int {
    // Temporarily place an opponent piece on the square
    let orig = game.piece(at: square)
    let tempPiece = Piece(kind: pieceKind, color: moverColor.opposite)
    game.setPieceForCoachAnalysis(tempPiece, at: square)
    let moves = game.legalMoves(for: moverColor)
    var count = 0
    for m in moves {
        guard m.to == square else { continue }
        guard m.from != square else { continue }
        guard let piece = game.piece(at: m.from) else { continue }
        // Skip pawn pushes
        if piece.kind == .pawn && m.from.col == m.to.col { continue }
        count += 1
    }
    game.setPieceForCoachAnalysis(orig, at: square)
    return count
}

/// Check if a piece on the given square is "hung" after the move, and was not already hung before.
private func isHung(
    postMoveGame: ChessGame,
    square: Square,
    moverColor: PieceColor,
    preMoveGame: ChessGame
) -> Bool {
    guard let piece = postMoveGame.piece(at: square) else { return false }
    guard piece.kind != .king else { return false }
    guard piece.color == moverColor else { return false }

    let opponent = moverColor.opposite
    let (attackerCount, minAttackerVal) = countAttackers(game: postMoveGame, square: square, attackerColor: opponent)
    guard attackerCount > 0 else { return false }

    let defCount = countDefenders(game: postMoveGame, square: square, moverColor: moverColor, pieceKind: piece.kind)
    let pv = piece.kind.value
    let isCurrentlyHung = defCount == 0 || minAttackerVal < pv
    guard isCurrentlyHung else { return false }

    // Check if it was already hung before the move
    if let prePiece = preMoveGame.piece(at: square), prePiece.color == moverColor, prePiece.kind != .king {
        let (preAtk, preMinVal) = countAttackers(game: preMoveGame, square: square, attackerColor: opponent)
        let preDefCount = countDefenders(game: preMoveGame, square: square, moverColor: moverColor, pieceKind: prePiece.kind)
        let wasAlreadyHung = preAtk > 0 && (preDefCount == 0 || preMinVal < pv)
        if wasAlreadyHung { return false }
    }

    return true
}

// MARK: - explainMove

func explainMove(_ input: ExplainInput) -> String {
    let sign = input.mover == .white ? 1 : -1

    // 1. Walked into mate
    if let mateIn = input.after.mateIn, mateIn * sign < 0 {
        return "This allows mate in \(abs(mateIn))."
    }

    // 2. Missed mate
    let best = input.bestMoveUci ?? input.pv.first
    if let beforeMate = input.before.mateIn, beforeMate * sign > 0, let best {
        if input.movePlayed != best {
            return "You had mate in \(abs(beforeMate)), starting with \(best)."
        }
    }

    // Parse pre-move game
    guard let preMoveGame = try? ChessGame.fromFEN(input.fen) else {
        return fallbackExplain(bestMoveUci: input.bestMoveUci)
    }

    let moveObj = preMoveGame.move(fromEngineUCI: input.movePlayed) ?? preMoveGame.move(from: input.movePlayed)
    if let moveObj {
        let postMoveGame = preMoveGame.copy()
        postMoveGame.applyMoveUnchecked(moveObj, recordHistory: false)
        let preMoveGame2 = (try? ChessGame.fromFEN(input.fen)) ?? preMoveGame.copy()

        // 3. Hung piece — check destination square first, then other mover-colored non-king pieces
        var squaresToCheck: [Square] = []
        let movedTo = moveObj.to
        if let movedPiece = postMoveGame.piece(at: movedTo), movedPiece.kind != .king {
            squaresToCheck.append(movedTo)
        }
        for r in 0..<BoardConstants.size {
            for c in 0..<BoardConstants.size {
                let sq = Square(row: r, col: c)
                if sq == movedTo { continue }
                if let p = postMoveGame.piece(at: sq), p.color == input.mover, p.kind != .king {
                    squaresToCheck.append(sq)
                }
            }
        }

        for sq in squaresToCheck {
            if isHung(postMoveGame: postMoveGame, square: sq, moverColor: input.mover, preMoveGame: preMoveGame2) {
                let piece = postMoveGame.piece(at: sq)!
                let sqName = sq.notation
                return "Your \(pieceName(piece.kind)) on \(sqName) is hanging — it can simply be taken."
            }
        }

        // 4. Missed capture — best move captures a piece worth >= knight
        if let best {
            let bestMoveObj = preMoveGame2.move(fromEngineUCI: best) ?? preMoveGame2.move(from: best)
            if let bestMoveObj {
                let captured = preMoveGame2.piece(at: bestMoveObj.to)
                if let captured, captured.color != input.mover, captured.kind.value >= PieceKind.knight.value {
                    // Check that movePlayed is not itself an equal-or-greater capture
                    let playedCapture = preMoveGame2.piece(at: moveObj.to)
                    let playedCaptureValue = playedCapture.map { $0.kind.value } ?? 0
                    if playedCaptureValue < captured.kind.value {
                        let capName = pieceName(captured.kind)
                        let capSq = bestMoveObj.to.notation
                        return "You missed \(best), winning the \(capName) on \(capSq)."
                    }
                }
            }
        }
    }

    // 5. Generic fallback
    return fallbackExplain(bestMoveUci: input.bestMoveUci)
}

private func fallbackExplain(bestMoveUci: String?) -> String {
    if let best = bestMoveUci {
        return "This loses ground — the engine preferred \(best)."
    }
    return "This loses ground."
}

// MARK: - hintWhy

func hintWhy(fen: String, bestUci: String, evalAtPosition: PositionEval?, mover: PieceColor) -> String? {
    guard let evalAtPosition else { return nil }

    let sign = mover == .white ? 1 : -1

    // 1. Mate favorable to mover
    if let mateIn = evalAtPosition.mateIn, mateIn * sign > 0 {
        return "Mates in \(abs(mateIn))."
    }

    guard let game = try? ChessGame.fromFEN(fen) else {
        let moverCp = max(0, normalizedCp(evalAtPosition) * sign)
        return "Engine's top move (+\(String(format: "%.1f", Double(moverCp) / 100.0)))."
    }

    let bestMove = game.move(fromEngineUCI: bestUci) ?? game.move(from: bestUci)
    guard let bestMove else {
        let moverCp = max(0, normalizedCp(evalAtPosition) * sign)
        return "Engine's top move (+\(String(format: "%.1f", Double(moverCp) / 100.0)))."
    }

    // 2. Best move is a capture
    if let captured = game.piece(at: bestMove.to), captured.color != mover {
        return "Wins the \(pieceName(captured.kind)) on \(bestMove.to.notation)."
    }

    // 3. Best move gives check
    let afterGame = game.copy()
    afterGame.applyMoveUnchecked(bestMove, recordHistory: false)
    if afterGame.isInCheck(color: mover.opposite) {
        return "Forcing check."
    }

    // 4. Generic
    let moverCp = max(0, normalizedCp(evalAtPosition) * sign)
    return "Engine's top move (+\(String(format: "%.1f", Double(moverCp) / 100.0)))."
}
