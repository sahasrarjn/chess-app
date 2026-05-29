import Foundation

/// Pick a random legal move when the remote engine is unavailable.
func pickFallbackMove(in game: ChessGame) -> Move? {
    let moves = game.legalMoves()
    guard !moves.isEmpty else { return nil }
    return moves.randomElement()
}
