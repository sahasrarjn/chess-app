import XCTest
@testable import Chess_Border

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
}
