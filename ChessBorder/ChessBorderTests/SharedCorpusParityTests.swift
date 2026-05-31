import XCTest
@testable import Border_Chess

/// Shared JSON corpus parity with web (`engine-fen-corpus.json`, `posthog-regression-fens.json`).
final class SharedCorpusParityTests: XCTestCase {
    private struct CorpusCase: Decodable {
        let name: String
        let fen: String
        let uci: String?
        let setup_uci: [String]?
    }

    private struct RegressionCase: Decodable {
        let name: String
        let fen: String
    }

    private func loadJSON<T: Decodable>(_ name: String) throws -> T {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let url = repoRoot.appendingPathComponent("shared/\(name).json")
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw NSError(domain: "SharedCorpusParityTests", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Missing shared/\(name).json at \(url.path)",
            ])
        }
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func matchCorpusMove(_ game: ChessGame, _ uci: String) -> Move? {
        game.move(fromEngineUCI: uci) ?? game.move(from: uci)
    }

    private func applyUCI(_ game: ChessGame, _ uci: String) -> Bool {
        guard let move = matchCorpusMove(game, uci) else { return false }
        return game.applyMove(move)
    }

    func testSharedEngineCorpusMovesAreLegal() throws {
        let cases: [CorpusCase] = try loadJSON("engine-fen-corpus")
        XCTAssertFalse(cases.isEmpty)

        for entry in cases {
            let game = try ChessGame.fromFEN(entry.fen)
            for setup in entry.setup_uci ?? [] {
                XCTAssertTrue(applyUCI(game, setup), "\(entry.name): setup \(setup) should be legal")
            }
            guard let uci = entry.uci else { continue }
            guard let move = matchCorpusMove(game, uci) else {
                XCTFail("\(entry.name): could not parse UCI \(uci)")
                continue
            }
            let legal = game.legalMoves(for: game.activeColor).contains {
                $0.from == move.from && $0.to == move.to && $0.promotion == move.promotion
            }
            XCTAssertTrue(legal, "\(entry.name): \(uci) must be legal for side to move")
        }
    }

    func testPostHogRegressionFensLoadWithLegalMoves() throws {
        let cases: [RegressionCase] = try loadJSON("posthog-regression-fens")
        XCTAssertFalse(cases.isEmpty)

        for entry in cases {
            let game = try ChessGame.fromFEN(entry.fen)
            XCTAssertFalse(game.legalMoves().isEmpty, "\(entry.name): side to move should have legal moves")
            let roundTrip = try ChessGame.fromFEN(game.toFEN())
            XCTAssertEqual(
                roundTrip.legalMoves().count,
                game.legalMoves().count,
                "\(entry.name): FEN round-trip should preserve legal move count"
            )
        }
    }

    func testFENRoundTripPreservesLeftBorderPiece() throws {
        let fen = "R......../........../........../........../........../........../........../........../........../.......... w - - 0 1"
        let game = try ChessGame.fromFEN(fen)
        XCTAssertEqual(game.board[0][0]?.kind, .rook)
        XCTAssertFalse(game.legalMoves().isEmpty)
        let again = try ChessGame.fromFEN(game.toFEN())
        XCTAssertEqual(again.board[0][0]?.kind, .rook)
    }
}
