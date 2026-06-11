import XCTest
@testable import Border_Chess

// MARK: - Test fixtures (mirrors web/src/coach/testFixtures.ts)

private struct TestFixture {
    let name: String
    let fen: String
    let movePlayed: String
    let bestMoveUci: String
    let pv: [String]
    let before: PositionEval
    let after: PositionEval
    let mover: PieceColor
    let expectedClassification: MoveClassification
}

private func cp(_ n: Int) -> PositionEval { PositionEval.cp(n) }
private func mate(_ n: Int) -> PositionEval { PositionEval.mate(n) }

private let FIXTURES: [TestFixture] = [
    TestFixture(
        name: "HUNG_QUEEN",
        fen: "........../....rk..../........../........../........../........../........../........../....QK..../.......... w - - 0 1",
        movePlayed: "d1d5",
        bestMoveUci: "d1h5",
        pv: ["d1h5"],
        before: cp(+50),
        after: cp(-850),
        mover: .white,
        expectedClassification: .blunder
    ),
    TestFixture(
        name: "HUNG_KNIGHT",
        fen: "........../.....k..../........../........../........../.....p..../........../........../.....K.N../.......... w - - 0 1",
        movePlayed: "g1f3",
        bestMoveUci: "g1h3",
        pv: ["g1h3"],
        before: cp(+20),
        after: cp(-250),
        mover: .white,
        expectedClassification: .mistake
    ),
    TestFixture(
        name: "MISSED_CAPTURE_QUEEN",
        fen: "........../.....k..../........../........../....q...../........../........../........../....RK..../.......... w - - 0 1",
        movePlayed: "e1e2",
        bestMoveUci: "d1d5",
        pv: ["d1d5"],
        before: cp(+500),
        after: cp(-350),
        mover: .white,
        expectedClassification: .blunder
    ),
    TestFixture(
        name: "MISSED_CAPTURE_ROOK",
        fen: "........../.....k..../........../........../.......r../........../........../........../...B.K..../.......... w - - 0 1",
        movePlayed: "e1d1",
        bestMoveUci: "c1g5",
        pv: ["c1g5"],
        before: cp(+480),
        after: cp(-20),
        mover: .white,
        expectedClassification: .blunder
    ),
    TestFixture(
        name: "MISSED_MATE_1",
        fen: "........../........k./......K.../........../........../........../........../........../.......Q../.......... w - - 0 1",
        movePlayed: "g1g2",
        bestMoveUci: "g1g8",
        pv: ["g1g8"],
        before: mate(+1),
        after: cp(+900),
        mover: .white,
        expectedClassification: .mistake
    ),
    TestFixture(
        name: "MISSED_MATE_2",
        fen: "........../.....k..../.R......../........../........../........../........../........../..R..K..../.......... w - - 0 1",
        movePlayed: "e1d1",
        bestMoveUci: "b1b8",
        pv: ["b1b8"],
        before: mate(+2),
        after: cp(+1200),
        mover: .white,
        expectedClassification: .mistake
    ),
    TestFixture(
        name: "WALKED_INTO_MATE_1",
        fen: "........../.....k..../........../....q...../...b....../........../........../......PPP./.......K../.......... w - - 0 1",
        movePlayed: "h2h3",
        bestMoveUci: "g1f1",
        pv: ["g1f1"],
        before: cp(-80),
        after: mate(-2),
        mover: .white,
        expectedClassification: .blunder
    ),
    TestFixture(
        name: "WALKED_INTO_MATE_2",
        fen: "........../.......k../......ppp./........../........../........../....Q...../........../.....K..../.......... b - - 0 1",
        movePlayed: "h7h6",
        bestMoveUci: "g8h8",
        pv: ["g8h8"],
        before: cp(+60),
        after: mate(+1),
        mover: .black,
        expectedClassification: .blunder
    ),
    TestFixture(
        name: "GENERIC_1",
        fen: "........../.rnbqkbnr./.pppppppp./......../......../......../......../.PPPPPPPP./.RNBQKBNR./.......... w KQkq - 0 1",
        movePlayed: "b1a3",
        bestMoveUci: "e2e4",
        pv: ["e2e4"],
        before: cp(+25),
        after: cp(-135),
        mover: .white,
        expectedClassification: .mistake
    ),
    TestFixture(
        name: "GENERIC_2",
        // After 1.e4 (white); black to move. White e pawn is on e4 (row5,col5).
        // Row 5 = e4 pawn (.....P....), row 7 = white pawns without e pawn (.PPPP.PPP.)
        fen: "........../.rnbqkbnr./.pppppppp./........../.......  ./.....P..../........../.PPPP.PPP./.RNBQKBNR./.......... b KQkq - 0 1".replacingOccurrences(of: "  ", with: ".."),
        movePlayed: "g8h6",
        bestMoveUci: "e7e5",
        pv: ["e7e5"],
        before: cp(+30),
        after: cp(+190),
        mover: .black,
        expectedClassification: .mistake
    ),
]

// MARK: - Tests

final class CoachTests: XCTestCase {

    // MARK: 1. Fixture classifications

    func testFixtureClassifications() {
        for f in FIXTURES {
            let result = classifyMove(before: f.before, after: f.after, mover: f.mover)
            XCTAssertEqual(result, f.expectedClassification, "\(f.name): expected \(f.expectedClassification.rawValue) got \(result.rawValue)")
        }
    }

    // MARK: 2. Threshold table

    func testThresholdTable() {
        let white = PieceColor.white
        // ok
        XCTAssertEqual(classifyMove(before: cp(0), after: cp(0), mover: white), .ok)
        XCTAssertEqual(classifyMove(before: cp(100), after: cp(51), mover: white), .ok)
        // inaccuracy: swing 50–149
        XCTAssertEqual(classifyMove(before: cp(100), after: cp(50), mover: white), .inaccuracy)
        XCTAssertEqual(classifyMove(before: cp(200), after: cp(51), mover: white), .inaccuracy)
        // mistake: swing 150–299
        XCTAssertEqual(classifyMove(before: cp(200), after: cp(50), mover: white), .mistake)
        XCTAssertEqual(classifyMove(before: cp(300), after: cp(1), mover: white), .mistake)
        // blunder: swing >= 300
        XCTAssertEqual(classifyMove(before: cp(400), after: cp(100), mover: white), .blunder)
        XCTAssertEqual(classifyMove(before: cp(900), after: cp(-600), mover: white), .blunder)
    }

    // MARK: 3. Mate rules

    func testMateRulesHadMateNoMate() {
        // Had mate +1, now only winning: mistake (not blunder because moverAfter >= winningCp)
        let result = classifyMove(before: mate(+1), after: cp(+900), mover: .white)
        XCTAssertEqual(result, .mistake)
    }

    func testMateRulesHadMateNowLosing() {
        // Had mate +1, now losing: blunder
        let result = classifyMove(before: mate(+1), after: cp(-100), mover: .white)
        XCTAssertEqual(result, .blunder)
    }

    func testMateRulesWalkedIntoMate() {
        // Was not mated, now walks into mate: blunder (moverBefore >= -winningCp: was cp(-80))
        let result = classifyMove(before: cp(-80), after: mate(-2), mover: .white)
        XCTAssertEqual(result, .blunder)
    }

    func testMateRulesWalkedIntoMateAlreadyLosing() {
        // Was heavily losing, walks into mate — still blunder since moverBefore >= -winningCp
        let result = classifyMove(before: cp(-200), after: mate(-1), mover: .white)
        XCTAssertEqual(result, .blunder)
    }

    func testMateRulesBlackWalksIntoMate() {
        // Black's move allows mate +1 for White (bad for black)
        let result = classifyMove(before: cp(+60), after: mate(+1), mover: .black)
        XCTAssertEqual(result, .blunder)
    }

    // MARK: 4. toWhiteRelative

    func testToWhiteRelativeBlackScore() {
        // Black side-to-move score cp=120 → white-relative = {cp: -120}
        let result = toWhiteRelative(scoreCp: 120, mateIn: nil, sideToMove: .black)
        XCTAssertEqual(result, PositionEval(cp: -120, mateIn: nil))
    }

    func testToWhiteRelativeWhiteScore() {
        let result = toWhiteRelative(scoreCp: 200, mateIn: nil, sideToMove: .white)
        XCTAssertEqual(result, PositionEval(cp: 200, mateIn: nil))
    }

    func testToWhiteRelativeBlackMate() {
        // Black side-to-move mate +1 → white-relative mate -1
        let result = toWhiteRelative(scoreCp: nil, mateIn: 1, sideToMove: .black)
        XCTAssertEqual(result, PositionEval(cp: nil, mateIn: -1))
    }

    func testToWhiteRelativeWhiteMate() {
        let result = toWhiteRelative(scoreCp: nil, mateIn: 2, sideToMove: .white)
        XCTAssertEqual(result, PositionEval(cp: nil, mateIn: 2))
    }

    // MARK: 5. Accuracy

    func testAccuracyMixed() {
        // [ok, ok, mistake, blunder] → penalties [0, 0, 25, 50] total=75 avg=18.75 → 100 - 19 = 81
        let result = reviewAccuracy([.ok, .ok, .mistake, .blunder])
        XCTAssertEqual(result, 81)
    }

    func testAccuracyAllOk() {
        XCTAssertEqual(reviewAccuracy([.ok, .ok, .ok]), 100)
    }

    func testAccuracySingleBlunder() {
        // [blunder] → penalty 50 total=50 avg=50 → 100 - 50 = 50
        XCTAssertEqual(reviewAccuracy([.blunder]), 50)
    }

    func testAccuracyEmpty() {
        XCTAssertEqual(reviewAccuracy([]), 100)
    }

    // MARK: 6. Fixture validity

    func testFixtureFENsAreValid() {
        for f in FIXTURES {
            let game: ChessGame
            do {
                game = try ChessGame.fromFEN(f.fen)
            } catch {
                XCTFail("\(f.name): fromFEN threw \(error)")
                continue
            }
            let move = game.move(fromEngineUCI: f.movePlayed) ?? game.move(from: f.movePlayed)
            XCTAssertNotNil(move, "\(f.name): movePlayed \(f.movePlayed) not legal in FEN")
        }
    }
}
