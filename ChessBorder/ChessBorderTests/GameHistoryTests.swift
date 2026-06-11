import XCTest
@testable import Border_Chess

final class GameHistoryTests: XCTestCase {

    // Isolated UserDefaults suite so tests never touch the real suite.
    private var defaults: UserDefaults!
    private let suiteName = "com.test.GameHistoryTests"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suiteName)!
        GameHistoryStore.clear(defaults: defaults)
    }

    override func tearDown() {
        GameHistoryStore.clear(defaults: defaults)
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    // MARK: - Helpers

    private func makeRecord(
        gameId: String = UUID().uuidString,
        mode: String = "vsBot",
        difficulty: String? = "medium",
        playerColor: String? = "white",
        opponent: String = "Bot (medium)",
        moves: [String] = ["e2e4", "e7e5"],
        resultType: String = "checkmate",
        winner: String? = "white",
        endedAt: String = "2026-06-11T12:00:00Z"
    ) -> CompletedGameRecord {
        CompletedGameRecord(
            gameId: gameId,
            mode: mode,
            difficulty: difficulty,
            playerColor: playerColor,
            opponent: opponent,
            moves: moves,
            resultType: resultType,
            winner: winner,
            endedAt: endedAt
        )
    }

    // MARK: - Round-trip (newest first)

    func testAppendAndLoadRoundTrip() {
        let r1 = makeRecord(gameId: "g1", moves: ["a2a4"], endedAt: "2026-06-11T10:00:00Z")
        let r2 = makeRecord(gameId: "g2", moves: ["b2b4"], endedAt: "2026-06-11T11:00:00Z")

        XCTAssertTrue(GameHistoryStore.append(r1, defaults: defaults))
        XCTAssertTrue(GameHistoryStore.append(r2, defaults: defaults))

        let games = GameHistoryStore.load(defaults: defaults)
        XCTAssertEqual(games.count, 2)
        // Newest first: r2 was appended last so it is at index 0.
        XCTAssertEqual(games[0].gameId, "g2")
        XCTAssertEqual(games[1].gameId, "g1")
    }

    // MARK: - Cap at 25

    func testCappedAt25() {
        for i in 0..<26 {
            let r = makeRecord(
                gameId: "g\(i)",
                moves: ["e2e4", "e\(i % 7 + 2)e\(i % 3 + 3)", "d\(i)d\(i + 1)"],
                endedAt: "2026-06-11T\(String(format: "%02d", i % 24)):00:00Z"
            )
            GameHistoryStore.append(r, defaults: defaults)
        }
        let games = GameHistoryStore.load(defaults: defaults)
        XCTAssertEqual(games.count, GameHistoryStore.maxGames)
        XCTAssertEqual(games.count, 25)
    }

    func testOldestDroppedWhenCapExceeded() {
        // Append 26 records with distinct moves so none dedupe.
        var ids: [String] = []
        for i in 0..<26 {
            let id = "cap-\(i)"
            ids.append(id)
            let r = makeRecord(
                gameId: id,
                moves: ["a\(i % 8 + 1)a\(i % 8 + 2)", "b\(i)b\(i+1)", "c\(i)d\(i)"],
                resultType: "stalemate",
                winner: nil
            )
            GameHistoryStore.append(r, defaults: defaults)
        }
        let games = GameHistoryStore.load(defaults: defaults)
        XCTAssertEqual(games.count, 25)
        // The first appended (i=0) should have been dropped.
        XCTAssertFalse(games.map(\.gameId).contains("cap-0"))
        // The last appended (i=25) should be present and at position 0.
        XCTAssertEqual(games[0].gameId, "cap-25")
    }

    // MARK: - Dedupe

    func testDuplicateSameModeMovesResultTypeReturnsFalse() {
        let r1 = makeRecord(gameId: "orig", moves: ["e2e4", "e7e5"], resultType: "checkmate")
        // Same mode + moves + resultType, but different gameId and endedAt.
        let r2 = makeRecord(gameId: "dup", moves: ["e2e4", "e7e5"], resultType: "checkmate",
                            endedAt: "2026-06-12T00:00:00Z")

        XCTAssertTrue(GameHistoryStore.append(r1, defaults: defaults))
        let result = GameHistoryStore.append(r2, defaults: defaults)
        XCTAssertFalse(result, "Duplicate should not be appended")

        let games = GameHistoryStore.load(defaults: defaults)
        XCTAssertEqual(games.count, 1)
        XCTAssertEqual(games[0].gameId, "orig")
    }

    func testDifferentResultTypeIsNotDuplicate() {
        let r1 = makeRecord(moves: ["e2e4"], resultType: "checkmate", winner: "white")
        let r2 = makeRecord(moves: ["e2e4"], resultType: "stalemate", winner: nil)

        XCTAssertTrue(GameHistoryStore.append(r1, defaults: defaults))
        XCTAssertTrue(GameHistoryStore.append(r2, defaults: defaults),
                      "Different resultType should not be treated as duplicate")

        XCTAssertEqual(GameHistoryStore.load(defaults: defaults).count, 2)
    }

    func testDifferentMovesIsNotDuplicate() {
        let r1 = makeRecord(moves: ["e2e4", "e7e5"], resultType: "checkmate")
        let r2 = makeRecord(moves: ["d2d4", "d7d5"], resultType: "checkmate")

        XCTAssertTrue(GameHistoryStore.append(r1, defaults: defaults))
        XCTAssertTrue(GameHistoryStore.append(r2, defaults: defaults),
                      "Different moves should not be treated as duplicate")
    }

    // MARK: - Corrupt data

    func testCorruptDataReturnsEmpty() {
        defaults.set(Data("not valid json at all".utf8), forKey: "chessborder.gameHistory")
        let games = GameHistoryStore.load(defaults: defaults)
        XCTAssertEqual(games, [])
    }

    func testMissingKeyReturnsEmpty() {
        let games = GameHistoryStore.load(defaults: defaults)
        XCTAssertEqual(games, [])
    }

    // MARK: - CompletedGameRecord decodes from server-contract fixture

    func testCompletedGameRecordDecodesFromServerContractFixture() throws {
        // Matches the GameRecord shape from the plan's API contract.
        let json = """
        {
            "gameId": "srv-uuid-001",
            "mode": "vsBot",
            "difficulty": null,
            "playerColor": "white",
            "opponent": "Bot (medium)",
            "moves": ["e2e4", "e7e5", "g1f3"],
            "resultType": "checkmate",
            "winner": "white",
            "endedAt": "2026-06-11T15:30:00.000Z"
        }
        """
        let record = try JSONDecoder().decode(CompletedGameRecord.self, from: Data(json.utf8))
        XCTAssertEqual(record.gameId, "srv-uuid-001")
        XCTAssertEqual(record.mode, "vsBot")
        XCTAssertNil(record.difficulty)
        XCTAssertEqual(record.playerColor, "white")
        XCTAssertEqual(record.moves, ["e2e4", "e7e5", "g1f3"])
        XCTAssertEqual(record.resultType, "checkmate")
        XCTAssertEqual(record.winner, "white")
        XCTAssertEqual(record.endedAt, "2026-06-11T15:30:00.000Z")
    }

    func testCompletedGameRecordDecodesNullWinner() throws {
        let json = """
        {
            "gameId": "srv-stalemate",
            "mode": "localTwoPlayer",
            "difficulty": null,
            "playerColor": null,
            "opponent": "Friend (local)",
            "moves": ["a2a4"],
            "resultType": "stalemate",
            "winner": null,
            "endedAt": "2026-06-11T09:00:00.000Z"
        }
        """
        let record = try JSONDecoder().decode(CompletedGameRecord.self, from: Data(json.utf8))
        XCTAssertNil(record.winner)
        XCTAssertNil(record.playerColor)
        XCTAssertEqual(record.mode, "localTwoPlayer")
    }

    // MARK: - Clear

    func testClearEmptiesHistory() {
        GameHistoryStore.append(makeRecord(), defaults: defaults)
        XCTAssertEqual(GameHistoryStore.load(defaults: defaults).count, 1)
        GameHistoryStore.clear(defaults: defaults)
        XCTAssertEqual(GameHistoryStore.load(defaults: defaults).count, 0)
    }
}
