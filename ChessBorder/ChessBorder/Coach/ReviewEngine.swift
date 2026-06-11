import Foundation

struct ReviewedMove {
    let ply: Int
    let uci: String
    let mover: PieceColor
    let classification: MoveClassification
    let swing: Int
    let bestMoveUci: String?
    let explanation: String?
}

struct ReviewResult {
    let moves: [ReviewedMove]
    let accuracy: (white: Int, black: Int)
    let keyMoments: [ReviewedMove]
}

let reviewPenalties: [MoveClassification: Int] = [
    .ok: 0, .inaccuracy: 10, .mistake: 25, .blunder: 50
]

func reviewAccuracy(_ classifications: [MoveClassification]) -> Int {
    if classifications.isEmpty { return 100 }
    let total = classifications.reduce(0) { $0 + (reviewPenalties[$1] ?? 0) }
    return max(0, 100 - Int((Double(total) / Double(classifications.count)).rounded()))
}

/// Sequential game review: analyse each position and classify moves.
/// `analyseFunc` defaults to `AnalyzeService.shared.analyse(in:movetimeMs:)`.
func analyzeGameReview(
    moves movesUci: [String],
    onProgress: @escaping (Int, Int) -> Void,
    analyseFunc: ((ChessGame, Int) async -> EngineAnalysis?)? = nil
) async -> ReviewResult {
    let analyse = analyseFunc ?? { game, ms in
        await AnalyzeService.shared.analyse(in: game, movetimeMs: ms)
    }

    let game = ChessGame()
    var evalCache: [Int: PositionEval] = [:]     // ply -> white-relative eval
    var bestCache: [Int: (best: String?, pv: [String])] = [:]
    var reviewedMoves: [ReviewedMove] = []
    let total = movesUci.count

    // Analyse the starting position (ply 0)
    let startAnalysis = await analyse(game.copy(), AnalyzeService.reviewMovetimeMs)
    if let a = startAnalysis {
        let wrel = toWhiteRelative(scoreCp: a.scoreCp, mateIn: a.mateIn, sideToMove: game.activeColor)
        evalCache[0] = wrel
        bestCache[0] = (best: a.bestMoveUci, pv: a.pv)
    }

    for (index, uci) in movesUci.enumerated() {
        let ply = index  // 0-indexed: ply 0 = position before move 0
        let mover = game.activeColor

        // Apply the move
        guard let move = game.move(fromEngineUCI: uci) ?? game.move(from: uci),
              game.applyMove(move) else {
            onProgress(index + 1, total)
            continue
        }

        let afterPly = index + 1  // position after this move

        // Check terminal
        let isTerminal = game.result != .ongoing

        // Analyse position after the move (unless terminal)
        var afterEval: PositionEval? = evalCache[afterPly]
        var afterBest: (best: String?, pv: [String])? = bestCache[afterPly]
        if afterEval == nil && !isTerminal {
            let analysis = await analyse(game.copy(), AnalyzeService.reviewMovetimeMs)
            if let a = analysis {
                let wrel = toWhiteRelative(scoreCp: a.scoreCp, mateIn: a.mateIn, sideToMove: game.activeColor)
                evalCache[afterPly] = wrel
                bestCache[afterPly] = (best: a.bestMoveUci, pv: a.pv)
                afterEval = wrel
                afterBest = (best: a.bestMoveUci, pv: a.pv)
            }
        } else if isTerminal {
            // Terminal position eval
            let terminalEval: PositionEval
            switch game.result {
            case .checkmate(let winner):
                terminalEval = PositionEval(cp: winner == .white ? mateCp : -mateCp, mateIn: nil)
            default:
                terminalEval = PositionEval(cp: 0, mateIn: nil)
            }
            evalCache[afterPly] = terminalEval
            afterEval = terminalEval
        }

        // Classify
        let beforeEval = evalCache[ply]
        let classification: MoveClassification
        let swing: Int

        if let before = beforeEval, let after = afterEval {
            classification = classifyMove(before: before, after: after, mover: mover)
            let s = mover == .white ? 1 : -1
            let moverBefore = normalizedCp(before) * s
            let moverAfter = normalizedCp(after) * s
            swing = max(0, moverBefore - moverAfter)
        } else {
            classification = .ok
            swing = 0
        }

        // Build explanation for mistakes and blunders
        let explanation: String?
        if classification == .mistake || classification == .blunder,
           let before = beforeEval, let after = afterEval {
            // Re-create the pre-move FEN
            let fenGame = ChessGame()
            var fenApplied = true
            for prevUci in movesUci.prefix(index) {
                guard let m = fenGame.move(fromEngineUCI: prevUci) ?? fenGame.move(from: prevUci),
                      fenGame.applyMove(m) else {
                    fenApplied = false
                    break
                }
            }
            if fenApplied {
                let input = ExplainInput(
                    fen: fenGame.toFEN(),
                    movePlayed: uci,
                    bestMoveUci: bestCache[ply]?.best,
                    pv: bestCache[ply]?.pv ?? [],
                    before: before,
                    after: after,
                    classification: classification,
                    mover: mover
                )
                explanation = explainMove(input)
            } else {
                explanation = nil
            }
        } else {
            explanation = nil
        }

        let reviewed = ReviewedMove(
            ply: afterPly,
            uci: uci,
            mover: mover,
            classification: classification,
            swing: swing,
            bestMoveUci: bestCache[ply]?.best,
            explanation: explanation
        )
        reviewedMoves.append(reviewed)
        onProgress(index + 1, total)
    }

    // Compute accuracy per side
    let whiteClassifications = reviewedMoves.filter { $0.mover == .white }.map { $0.classification }
    let blackClassifications = reviewedMoves.filter { $0.mover == .black }.map { $0.classification }

    let whiteAccuracy = reviewAccuracy(whiteClassifications)
    let blackAccuracy = reviewAccuracy(blackClassifications)

    // Key moments: top 3 by swing (mistake or blunder only)
    let keyMoments = reviewedMoves
        .filter { $0.classification == .mistake || $0.classification == .blunder }
        .sorted { $0.swing > $1.swing }
        .prefix(3)
        .map { $0 }

    return ReviewResult(
        moves: reviewedMoves,
        accuracy: (white: whiteAccuracy, black: blackAccuracy),
        keyMoments: keyMoments
    )
}
