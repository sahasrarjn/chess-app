import XCTest
@testable import Border_Chess

@MainActor
final class OnlineTests: XCTestCase {
    private func state(
        moves: [String],
        status: String,
        yourTurn: Bool,
        color: String? = "white",
        role: OnlineRole = .white,
        result: OnlineResult = OnlineResult(type: "ongoing", winner: nil, reason: nil),
        rematchOfferedBy: String? = nil
    ) -> OnlineState {
        OnlineState(
            roomId: "r",
            role: role,
            color: color,
            players: OnlineState.Players(
                white: OnlinePlayer(name: "Alice", connected: true),
                black: OnlinePlayer(name: "Bob", connected: true)
            ),
            moves: moves,
            status: status,
            result: result,
            yourTurn: yourTurn,
            rematchOfferedBy: rematchOfferedBy
        )
    }

    func testParseStateMessage() {
        let json = """
        {"type":"state","roomId":"r","role":"black","color":"black","players":{"white":{"name":"A","connected":true},"black":{"name":"B","connected":true}},"moves":[],"status":"active","result":{"type":"ongoing"},"yourTurn":false,"rematchOfferedBy":null}
        """
        guard case .state(let s)? = ServerMessage.parse(json) else {
            return XCTFail("expected a state message")
        }
        XCTAssertEqual(s.role, .black)
        XCTAssertEqual(s.pieceColor, .black)
        XCTAssertEqual(s.status, "active")
    }

    func testParseErrorMessage() {
        guard case .error(let msg)? = ServerMessage.parse(#"{"type":"error","message":"nope"}"#) else {
            return XCTFail("expected an error message")
        }
        XCTAssertEqual(msg, "nope")
    }

    func testEncodeJoin() throws {
        let data = try JSONEncoder().encode(ClientMessage.join(roomId: "r", token: "t", name: "n"))
        let str = String(data: data, encoding: .utf8)!
        XCTAssertTrue(str.contains("\"type\":\"join\""))
        XCTAssertTrue(str.contains("\"roomId\":\"r\""))
        XCTAssertTrue(str.contains("\"token\":\"t\""))
    }

    func testRoomIdFromInput() {
        XCTAssertEqual(OnlineIdentity.roomId(fromInput: "https://borderchess.org/play/?room=abc123"), "abc123")
        XCTAssertEqual(OnlineIdentity.roomId(fromInput: "  XYZ789 "), "xyz789")
        XCTAssertNil(OnlineIdentity.roomId(fromInput: "   "))
    }

    func testSeatingAndCanMove() {
        let vm = OnlineGameViewModel(roomId: "r")
        vm.handle(.state(state(moves: [], status: "active", yourTurn: true)))
        XCTAssertEqual(vm.pieceColor, .white)
        XCTAssertFalse(vm.boardFlipped)
        XCTAssertTrue(vm.canMove)

        vm.handle(.state(state(moves: [], status: "waiting", yourTurn: false)))
        XCTAssertFalse(vm.canMove)
    }

    func testOptimisticMoveAppliesLocallyAndBlocks() {
        let vm = OnlineGameViewModel(roomId: "r")
        vm.handle(.state(state(moves: [], status: "active", yourTurn: true)))

        let sample = ChessGame().legalMoves().first!
        vm.handleSquareTap(sample.from)
        XCTAssertTrue(vm.isSelected(sample.from))
        vm.handleSquareTap(sample.to)

        XCTAssertNotNil(vm.piece(at: sample.to), "piece moves optimistically")
        XCTAssertFalse(vm.canMove, "blocked until the server echo")
    }

    func testHistoryPreview() {
        let vm = OnlineGameViewModel(roomId: "r")
        let uci = ChessGame().legalMoves().first!.uci
        vm.handle(.state(state(moves: [uci], status: "active", yourTurn: false, color: "black", role: .black)))
        XCTAssertEqual(vm.livePly, 1)

        vm.goToMove(ply: 0)
        XCTAssertTrue(vm.isBrowsingHistory)
        vm.returnToLive()
        XCTAssertFalse(vm.isBrowsingHistory)
    }
}
