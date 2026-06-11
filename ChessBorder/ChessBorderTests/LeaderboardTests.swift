import XCTest
@testable import Border_Chess

final class LeaderboardTests: XCTestCase {

    // MARK: - 1. Full fixture decode

    func testDecodesFullFixture() throws {
        let json = """
        {
            "entries": [
                {
                    "rank": 1,
                    "displayName": "Alice",
                    "avatarUrl": "https://example.com/alice.png",
                    "wins": 42,
                    "games": 50
                },
                {
                    "rank": 2,
                    "displayName": "Bob",
                    "avatarUrl": null,
                    "wins": 30,
                    "games": 55
                }
            ],
            "me": {
                "rank": null,
                "displayName": "Me",
                "avatarUrl": null,
                "wins": 3,
                "games": 10,
                "stats": {
                    "bot_medium_w": 5,
                    "bot_medium_l": 2,
                    "bot_medium_d": 1,
                    "online_w": 3,
                    "online_l": 6,
                    "online_d": 1
                }
            }
        }
        """
        let response = try JSONDecoder().decode(LeaderboardResponse.self, from: Data(json.utf8))

        // entries
        XCTAssertEqual(response.entries.count, 2)
        let first = response.entries[0]
        XCTAssertEqual(first.rank, 1)
        XCTAssertEqual(first.displayName, "Alice")
        XCTAssertEqual(first.avatarUrl, "https://example.com/alice.png")
        XCTAssertEqual(first.wins, 42)
        XCTAssertEqual(first.games, 50)

        let second = response.entries[1]
        XCTAssertEqual(second.rank, 2)
        XCTAssertEqual(second.displayName, "Bob")
        XCTAssertNil(second.avatarUrl)

        // me
        let me = try XCTUnwrap(response.me)
        XCTAssertNil(me.rank)
        XCTAssertEqual(me.displayName, "Me")
        XCTAssertNil(me.avatarUrl)
        XCTAssertEqual(me.wins, 3)
        XCTAssertEqual(me.games, 10)
        XCTAssertEqual(me.stats["bot_medium_w"], 5)
        XCTAssertEqual(me.stats["online_w"], 3)
    }

    // MARK: - 2. Empty entries + null me

    func testDecodesEmptyEntriesAndNullMe() throws {
        let json = """
        {"entries": [], "me": null}
        """
        let response = try JSONDecoder().decode(LeaderboardResponse.self, from: Data(json.utf8))
        XCTAssertTrue(response.entries.isEmpty)
        XCTAssertNil(response.me)
    }

    // MARK: - 3. me with rank

    func testDecodesNonNullRank() throws {
        let json = """
        {
            "entries": [],
            "me": {
                "rank": 5,
                "displayName": "Player",
                "avatarUrl": null,
                "wins": 10,
                "games": 15,
                "stats": {}
            }
        }
        """
        let response = try JSONDecoder().decode(LeaderboardResponse.self, from: Data(json.utf8))
        let me = try XCTUnwrap(response.me)
        XCTAssertEqual(me.rank, 5)
    }

    // MARK: - 4. statLines helper

    func testStatLinesOnlineFirst() {
        let stats: [String: Int] = [
            "online_w": 3, "online_l": 5, "online_d": 2,
            "bot_easy_w": 10, "bot_easy_l": 2, "bot_easy_d": 0,
            "bot_medium_w": 4, "bot_medium_l": 4, "bot_medium_d": 0,
            "bot_hard_w": 1, "bot_hard_l": 8, "bot_hard_d": 1,
        ]
        let lines = LeaderboardView.statLines(stats)
        // Online must come first
        XCTAssertEqual(lines.first?.label, "Online")
        XCTAssertEqual(lines.first?.w, 3)
        XCTAssertEqual(lines.first?.l, 5)
        XCTAssertEqual(lines.first?.d, 2)
    }

    func testStatLinesBotDifficultyOrder() {
        let stats: [String: Int] = [
            "bot_easy_w": 1, "bot_easy_l": 0, "bot_easy_d": 0,
            "bot_medium_w": 2, "bot_medium_l": 0, "bot_medium_d": 0,
            "bot_hard_w": 3, "bot_hard_l": 0, "bot_hard_d": 0,
        ]
        let lines = LeaderboardView.statLines(stats)
        let labels = lines.map { $0.label }
        XCTAssertEqual(labels, ["Bot · easy", "Bot · medium", "Bot · hard"])
    }

    func testStatLinesOmitsZeroGameRows() {
        let stats: [String: Int] = [
            "online_w": 0, "online_l": 0, "online_d": 0,
            "bot_medium_w": 2, "bot_medium_l": 1, "bot_medium_d": 0,
        ]
        let lines = LeaderboardView.statLines(stats)
        // Online row has 0 games — must be omitted
        XCTAssertEqual(lines.count, 1)
        XCTAssertEqual(lines[0].label, "Bot · medium")
    }

    func testStatLinesEmptyStats() {
        let lines = LeaderboardView.statLines([:])
        XCTAssertTrue(lines.isEmpty)
    }

    // MARK: - winRateText

    func testWinRateTextZeroGames() {
        XCTAssertEqual(LeaderboardView.winRateText(w: 0, g: 0), "—")
    }

    func testWinRateTextRoundsPercent() {
        XCTAssertEqual(LeaderboardView.winRateText(w: 1, g: 3), "33%")
        XCTAssertEqual(LeaderboardView.winRateText(w: 2, g: 3), "67%")
        XCTAssertEqual(LeaderboardView.winRateText(w: 3, g: 3), "100%")
    }
}
