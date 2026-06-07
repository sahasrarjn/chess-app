import XCTest
@testable import Border_Chess

final class BotEvalTests: XCTestCase {
    private func applyUCI(_ game: ChessGame, _ uci: String) -> Bool {
        guard let move = game.move(from: uci) else { return false }
        return game.applyMove(move)
    }

    private func positionAfterWhiteF4() -> ChessGame {
        let game = ChessGame()
        XCTAssertTrue(applyUCI(game, "f2f4"), "White f2f4 should be legal")
        XCTAssertEqual(game.activeColor, .black)
        return game
    }

    func testStandardNotationMatchesLabels() {
        XCTAssertEqual(Square(row: 8, col: 4).notation, "d1")
        XCTAssertEqual(Square(row: 5, col: 5).notation, "e4")
        XCTAssertEqual(Square.fromStandardNotation("d1"), Square(row: 8, col: 4))
        XCTAssertEqual(Square.fromStandardNotation("e4"), Square(row: 5, col: 5))
    }

    func testEngineCoordinateLabelsCoverFullBoard() {
        XCTAssertEqual(BoardConstants.engineFileLabel(col: 0), "a")
        XCTAssertEqual(BoardConstants.engineFileLabel(col: 9), "j")
        XCTAssertNil(BoardConstants.engineFileLabel(col: -1))
        XCTAssertEqual(BoardConstants.engineRankLabel(row: 9), "1")
        XCTAssertEqual(BoardConstants.engineRankLabel(row: 0), "10")
        XCTAssertNil(BoardConstants.engineRankLabel(row: 10))

        for col in 0..<BoardConstants.size {
            XCTAssertEqual(
                BoardConstants.engineFileLabel(col: col),
                String(Square(row: 0, col: col).engineNotation.prefix(1))
            )
        }
        for row in 0..<BoardConstants.size {
            XCTAssertEqual(
                BoardConstants.engineRankLabel(row: row),
                String(Square(row: row, col: 0).engineNotation.dropFirst())
            )
        }
    }

    func testStartingPositionFENUsesDotsForFullEmptyRanks() {
        let fen = ChessGame().toFEN()
        XCTAssertFalse(fen.contains("10"), "Full empty ranks must not encode as \"10\" (invalid for remote engine)")
        XCTAssertTrue(fen.hasPrefix("........../"), "Top border rank should use ten dots")
        let ranks = fen.split(separator: " ").first?.split(separator: "/") ?? []
        XCTAssertEqual(ranks.count, BoardConstants.size)
        for rank in ranks {
            XCTAssertFalse(rank.contains("0"), "FEN ranks must not contain digit 0")
        }
    }

    func testAfterE4FENUsesEngineEnPassantSquare() throws {
        let game = ChessGame()
        guard let move = game.move(from: "e2e4"), game.applyMove(move) else {
            XCTFail("e2e4 should be legal")
            return
        }

        let fen = game.toFEN()
        XCTAssertFalse(fen.contains("10"))
        XCTAssertTrue(fen.contains(" f4 "), "En passant target must use 10×10 engine coordinates")
        try validateEngineAPIFEN(String(fen.split(separator: " ").first ?? Substring()))
    }

    private func validateEngineAPIFEN(_ placement: String) throws {
        let pattern = #"^[.1-9/prnbqkRNBQKPN]+(?:/[.1-9/prnbqkRNBQKPN]+){9}$"#
        let regex = try NSRegularExpression(pattern: pattern)
        let range = NSRange(placement.startIndex..<placement.endIndex, in: placement)
        XCTAssertNotNil(regex.firstMatch(in: placement, range: range), "FEN placement must match engine API rules")
    }

    func testStartingPositionBlackHasLegalMoves() {
        let game = ChessGame()
        XCTAssertEqual(game.activeColor, .white)
        let whiteMoves = game.legalMoves()
        XCTAssertFalse(whiteMoves.isEmpty)
        let probe = ChessGame()
        XCTAssertTrue(applyUCI(probe, "e2e4"))
        XCTAssertEqual(probe.activeColor, .black)
        let blackMoves = probe.legalMoves()
        XCTAssertFalse(blackMoves.isEmpty)
        XCTAssertTrue(blackMoves.allSatisfy { $0.to.isValid })
    }

    func testQueenCanStepBackOntoBorder() {
        let game = ChessGame()
        let queen = Square(row: 8, col: 4)
        let borderBehind = Square(row: 9, col: 4)
        let move = game.legalMoves().first { $0.from == queen && $0.to == borderBehind }
        XCTAssertNotNil(move, "Queen on d1 should reach the back-rank border square")
    }

    func testAfterF4HybridBotReturnsLegalMove() async {
        let game = positionAfterWhiteF4()
        let move = await HybridBotPlayer().chooseMove(in: game, difficulty: .easy)
        XCTAssertNotNil(move)
        guard let move else { return }
        XCTAssertTrue(move.from.isValid, "from \(move.uci) must be on board")
        XCTAssertTrue(move.to.isValid, "to \(move.uci) must be on board")
        XCTAssertTrue(
            game.legalMoves().contains { $0.from == move.from && $0.to == move.to && $0.promotion == move.promotion }
        )
    }

    func testAfterF4MinimaxBotReturnsLegalMove() async {
        let game = positionAfterWhiteF4()
        let move = await MinimaxBotPlayer().chooseMove(in: game, difficulty: .easy)
        XCTAssertNotNil(move)
        guard let move else { return }
        XCTAssertTrue(move.to.isValid)
    }

    func testApplyingBotMoveAdvancesGame() async {
        var game = positionAfterWhiteF4()
        let plyBefore = game.recordedMoves.count
        let move = await HybridBotPlayer().chooseMove(in: game, difficulty: .easy)
        XCTAssertNotNil(move)
        guard let move, let piece = game.piece(at: move.from) else { return }
        XCTAssertTrue(game.applyMove(move))
        XCTAssertEqual(game.recordedMoves.count, plyBefore + 1)
        XCTAssertEqual(game.activeColor, .white)
        XCTAssertEqual(game.lastMove?.to, move.to)
        XCTAssertNotNil(piece)
    }

    func testEngineUCIParsesKnightMove() {
        let game = ChessGame()
        _ = applyUCI(game, "f2f4")
        let move = game.move(fromEngineUCI: "h9g7")
        XCTAssertNotNil(move, "Engine Nf6 (h9g7) should parse after f4")
        XCTAssertTrue(game.legalMoves().contains { $0.from == move!.from && $0.to == move!.to })
    }

    func testHybridUsesEngineWhenAvailable() async throws {
        guard EngineBundle.isFairyStockfishAvailable else {
            throw XCTSkip("Fairy-Stockfish binary not bundled in test host")
        }
        let game = positionAfterWhiteF4()
        let start = ContinuousClock.now
        let move = await HybridBotPlayer().chooseMove(in: game, difficulty: .easy)
        let elapsed = start.duration(to: .now)
        XCTAssertNotNil(move)
        XCTAssertLessThan(elapsed, .seconds(3), "Engine move should return within a few seconds")
    }

    func testHybridReliableWhenEngineReturnsBorderOrPlayable() async throws {
        guard EngineBundle.isFairyStockfishAvailable else {
            throw XCTSkip("Fairy-Stockfish binary not bundled in test host")
        }
        let game = positionAfterWhiteF4()
        let hybridMove = await HybridBotPlayer().chooseMove(in: game, difficulty: .easy)
        XCTAssertNotNil(hybridMove)
        XCTAssertTrue(hybridMove?.to.isValid == true)

        let engineMove = await FairyStockfishBot.shared.chooseMove(in: game, difficulty: .easy)
        if let engineMove {
            XCTAssertTrue(
                engineMove.to.isValid,
                "Engine moves must stay on the 10×10 board"
            )
        }
    }

    func testInnerBoardMovesStayOnStandardSquares() {
        let game = ChessGame()
        let innerMoves = game.legalMoves().filter { $0.from.isPlayable && $0.to.isPlayable }
        XCTAssertFalse(innerMoves.isEmpty)
    }

    func testEdgeSquareMovesInward() {
        let game = ChessGame()
        let knightSquare = Square(row: 8, col: 7)
        let inward = Square(row: 6, col: 6)
        let move = game.legalMoves().first { $0.from == knightSquare && $0.to == inward }
        XCTAssertNotNil(move, "Knight on h1 should jump to f3")
    }

    // MARK: - App update version comparison

    func testCompareVersionsNumericNotLexicographic() {
        XCTAssertEqual(compareVersions("1.0.10", "1.0.2"), .orderedDescending)
        XCTAssertEqual(compareVersions("1.0.2", "1.0.10"), .orderedAscending)
    }

    func testCompareVersionsEqualAndShortForms() {
        XCTAssertEqual(compareVersions("1.0.1", "1.0.1"), .orderedSame)
        XCTAssertEqual(compareVersions("1.1", "1.0.9"), .orderedDescending)
        XCTAssertEqual(compareVersions("1.0", "1.0.0"), .orderedSame)
        XCTAssertEqual(compareVersions("2.0", "1.9.9"), .orderedDescending)
    }

    // MARK: - Easy difficulty

    func testEasyIsVeryWeak() {
        // Shallow search + frequent random moves make Easy beatable by a true beginner.
        XCTAssertEqual(BotDifficulty.easy.searchDepth, 1)
        XCTAssertGreaterThanOrEqual(BotDifficulty.easy.randomness, 0.5)
        XCTAssertLessThanOrEqual(BotDifficulty.easy.targetElo, 800)
        XCTAssertLessThan(BotDifficulty.easy.searchDepth, BotDifficulty.medium.searchDepth)
        XCTAssertGreaterThan(BotDifficulty.easy.randomness, BotDifficulty.medium.randomness)
    }
}
