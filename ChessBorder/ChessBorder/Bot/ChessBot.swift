import Foundation

struct ChessBot {
    let difficulty: BotDifficulty

    func chooseMove(in game: ChessGame) -> Move? {
        let moves = game.legalMoves()
        guard !moves.isEmpty else { return nil }

        if difficulty.randomness > 0, Double.random(in: 0...1) < difficulty.randomness {
            return moves.randomElement()
        }

        let color = game.activeColor
        var bestMove = moves[0]
        var bestScore = Int.min

        for move in moves {
            let copy = game.copy()
            copy.applyMoveUnchecked(move, recordHistory: false)
            let score = minimax(
                game: copy,
                depth: difficulty.searchDepth - 1,
                alpha: Int.min,
                beta: Int.max,
                maximizing: color.opposite,
                rootColor: color
            )
            if score > bestScore {
                bestScore = score
                bestMove = move
            }
        }
        return bestMove
    }

    private func minimax(
        game: ChessGame,
        depth: Int,
        alpha: Int,
        beta: Int,
        maximizing: PieceColor,
        rootColor: PieceColor
    ) -> Int {
        switch game.result {
        case .checkmate(let winner):
            return winner == rootColor ? 100_000 - (difficulty.searchDepth - depth) : -100_000 + (difficulty.searchDepth - depth)
        case .stalemate, .draw, .resignation:
            return 0
        case .ongoing:
            break
        }

        if depth == 0 {
            return evaluate(game: game, for: rootColor)
        }

        let moves = game.legalMoves(for: maximizing)
        var alpha = alpha
        var beta = beta

        if maximizing == rootColor {
            var maxEval = Int.min
            for move in moves {
                let copy = game.copy()
                copy.applyMoveUnchecked(move, recordHistory: false)
                let eval = minimax(
                    game: copy,
                    depth: depth - 1,
                    alpha: alpha,
                    beta: beta,
                    maximizing: maximizing.opposite,
                    rootColor: rootColor
                )
                maxEval = max(maxEval, eval)
                alpha = max(alpha, eval)
                if beta <= alpha { break }
            }
            return maxEval
        } else {
            var minEval = Int.max
            for move in moves {
                let copy = game.copy()
                copy.applyMoveUnchecked(move, recordHistory: false)
                let eval = minimax(
                    game: copy,
                    depth: depth - 1,
                    alpha: alpha,
                    beta: beta,
                    maximizing: maximizing.opposite,
                    rootColor: rootColor
                )
                minEval = min(minEval, eval)
                beta = min(beta, eval)
                if beta <= alpha { break }
            }
            return minEval
        }
    }

    private func evaluate(game: ChessGame, for color: PieceColor) -> Int {
        var score = game.materialScore(for: color)

        let centerSquares = [(4, 4), (4, 5), (5, 4), (5, 5)]
        for row in 0..<BoardConstants.size {
            for col in 0..<BoardConstants.size {
                guard let piece = game.piece(at: Square(row: row, col: col)) else { continue }
                var pieceScore = 0
                if centerSquares.contains(where: { $0.0 == row && $0.1 == col }) {
                    pieceScore += 15
                }
                if piece.kind == .pawn {
                    let advanced = color == .white ? (7 - row) : (row - 2)
                    pieceScore += advanced * 8
                }
                score += piece.color == color ? pieceScore : -pieceScore
            }
        }

        if game.isInCheck(color: color.opposite) { score += 30 }
        if game.isInCheck(color: color) { score -= 30 }

        return score
    }
}
