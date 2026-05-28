import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

struct ActiveMoveAnimation: Equatable {
    let move: Move
    let piece: Piece
}

@MainActor
final class GameViewModel: ObservableObject {
    var livePly: Int { game.recordedMoves.count }

    @Published private(set) var game = ChessGame()
    @Published private(set) var boardRevision = 0
    @Published var selectedSquare: Square?
    @Published private(set) var legalTargets: Set<Square> = []
    @Published private(set) var captureTargets: Set<Square> = []
    @Published var pendingPromotion: (from: Square, to: Square)?
    @Published var isThinking = false
    @Published var boardFlipped = false
    @Published var previewPly: Int?
    @Published var activeMoveAnimation: ActiveMoveAnimation?
    @Published private(set) var botEngineError: String?

    let mode: GameMode
    let botDifficulty: BotDifficulty

    private static let moveAnimationDuration: TimeInterval = 0.32
    private static let animationWaitTimeout: Duration = .seconds(2)

    init(mode: GameMode, botDifficulty: BotDifficulty = .medium) {
        self.mode = mode
        self.botDifficulty = botDifficulty
    }

    var isBrowsingHistory: Bool {
        guard let previewPly else { return false }
        return previewPly < livePly
    }

    var displaySnapshot: GameSnapshot {
        if let previewPly {
            return game.snapshot(atPly: previewPly)
        }
        return GameSnapshot(from: game)
    }

    var recordedMoves: [RecordedMove] { game.recordedMoves }
    var activeColor: PieceColor {
        isBrowsingHistory ? displaySnapshot.activeColor : game.activeColor
    }

    var lastMove: Move? {
        isBrowsingHistory ? displaySnapshot.lastMove : game.lastMove
    }
    var result: GameResult { game.result }
    var isBotTurn: Bool {
        mode == .vsBot && game.activeColor == .black && game.result == .ongoing && !isBrowsingHistory
    }

    var canRetryBot: Bool {
        mode == .vsBot
            && botEngineError != nil
            && game.activeColor == .black
            && game.result == .ongoing
            && !isThinking
            && !isBrowsingHistory
    }

    var canInteract: Bool {
        game.result == .ongoing && !isThinking && !isBotTurn && !isBrowsingHistory && activeMoveAnimation == nil
    }

    func piece(at square: Square) -> Piece? {
        if isBrowsingHistory {
            return displaySnapshot.piece(at: square)
        }
        if let anim = activeMoveAnimation {
            if anim.move.from == square || anim.move.to == square {
                return nil
            }
        }
        return game.piece(at: square)
    }

    func isAnimatingMove(from square: Square) -> Bool {
        activeMoveAnimation?.move.from == square
    }

    func isAnimatingMove(to square: Square) -> Bool {
        activeMoveAnimation?.move.to == square
    }

    var capturedByWhite: [Piece] {
        capturedPieces(for: .white, upToPly: displayedPly)
    }

    var capturedByBlack: [Piece] {
        capturedPieces(for: .black, upToPly: displayedPly)
    }

    private var displayedPly: Int {
        previewPly ?? livePly
    }

    private func capturedPieces(for capturer: PieceColor, upToPly ply: Int) -> [Piece] {
        game.recordedMoves
            .filter { $0.ply < ply }
            .compactMap { record -> Piece? in
                guard record.color == capturer, let captured = record.captured else { return nil }
                return captured
            }
    }

    func squareBackgroundColor(_ square: Square) -> Color {
        let isLight = (square.row + square.col) % 2 == 0
        if BoardConstants.isBorder(row: square.row, col: square.col) {
            return isLight ? BoardTheme.borderLightSquare : BoardTheme.borderDarkSquare
        }
        return isLight ? BoardTheme.lightSquare : BoardTheme.darkSquare
    }

    func isSelected(_ square: Square) -> Bool {
        selectedSquare == square
    }

    func isLegalTarget(_ square: Square) -> Bool {
        legalTargets.contains(square)
    }

    func isCaptureTarget(_ square: Square) -> Bool {
        captureTargets.contains(square)
    }

    func isLastMoveSquare(_ square: Square) -> Bool {
        guard let lastMove else { return false }
        return lastMove.from == square || lastMove.to == square
    }

    func isKingInCheck(_ square: Square) -> Bool {
        guard !isBrowsingHistory else { return false }
        guard let piece = game.piece(at: square), piece.kind == .king else { return false }
        return game.isInCheck(color: piece.color) && game.activeColor == piece.color
    }

    func handleSquareTap(_ square: Square) {
        let hasSelectablePiece = game.piece(at: square)?.color == game.activeColor
        let isLegalDestination = legalTargets.contains(square)
        guard square.isPlayable || hasSelectablePiece || isLegalDestination else { return }
        guard canInteract else { return }

        if let selected = selectedSquare {
            if selected == square {
                clearSelection()
                return
            }

            if tryExecuteMove(from: selected, to: square, triggerBot: true) {
                return
            }

            if let piece = game.piece(at: square), piece.color == game.activeColor {
                select(square)
            } else {
                clearSelection()
            }
            return
        }

        if let piece = game.piece(at: square), piece.color == game.activeColor {
            select(square)
        }
    }

    func goToMove(ply: Int) {
        if ply >= livePly {
            returnToLivePosition()
        } else {
            previewPly = ply
        }
        clearSelection()
    }

    func returnToLivePosition() {
        previewPly = nil
        clearSelection()
    }

    func stepBack() {
        goToMove(ply: max((previewPly ?? livePly) - 1, 0))
    }

    func stepForward() {
        let current = previewPly ?? livePly
        if current >= livePly {
            returnToLivePosition()
        } else {
            goToMove(ply: current + 1)
        }
    }

    private func select(_ square: Square) {
        selectedSquare = square
        let moves = game.legalMoves().filter { $0.from == square }
        legalTargets = Set(moves.map(\.to))
        captureTargets = Set(
            moves.filter { move in
                game.piece(at: move.to) != nil || move.isEnPassant
            }.map(\.to)
        )
        playSelectionHaptic()
    }

    private func clearSelection() {
        selectedSquare = nil
        legalTargets = []
        captureTargets = []
    }

    private func tryExecuteMove(from: Square, to: Square, triggerBot: Bool = false) -> Bool {
        let candidates = game.legalMoves().filter { $0.from == from && $0.to == to }

        if candidates.contains(where: { $0.promotion != nil }) {
            pendingPromotion = (from, to)
            return true
        }

        guard let move = candidates.first,
              let piece = game.piece(at: from) else { return false }

        guard game.applyMove(move) else { return false }

        previewPly = nil
        clearSelection()
        beginMoveAnimation(move: move, piece: piece)
        notifyChange()
        if triggerBot {
            maybePlayBotMove()
        }
        return true
    }

    func promote(to kind: PieceKind) {
        guard let pending = pendingPromotion else { return }
        let move = game.legalMoves().first {
            $0.from == pending.from && $0.to == pending.to && $0.promotion == kind
        }
        pendingPromotion = nil
        guard let move, let pawn = game.piece(at: move.from) else { return }
        guard game.applyMove(move) else { return }
        previewPly = nil
        clearSelection()
        beginMoveAnimation(move: move, piece: Piece(kind: kind, color: pawn.color))
        notifyChange()
        maybePlayBotMove()
    }

    func cancelPromotion() {
        pendingPromotion = nil
        clearSelection()
    }

    func undo() {
        let movesToUndo = mode == .vsBot ? 2 : 1
        var undone = false
        for _ in 0..<movesToUndo {
            if game.undoLastMove() { undone = true } else { break }
        }
        if undone {
            activeMoveAnimation = nil
            returnToLivePosition()
            botEngineError = nil
            notifyChange()
        }
        clearSelection()
    }

    func resignGame() {
        game.resign(by: game.activeColor)
        notifyChange()
    }

    func newGame() {
        game = ChessGame()
        clearSelection()
        pendingPromotion = nil
        isThinking = false
        boardFlipped = false
        previewPly = nil
        activeMoveAnimation = nil
        botEngineError = nil
        notifyChange()
    }

    func toggleBoardFlip() {
        boardFlipped.toggle()
    }

    func retryBotMove() {
        guard canRetryBot else { return }
        botEngineError = nil
        maybePlayBotMove()
    }

    private func beginMoveAnimation(move: Move, piece: Piece) {
        activeMoveAnimation = ActiveMoveAnimation(move: move, piece: piece)
        notifyChange()

        Task { @MainActor in
            try? await Task.sleep(for: .seconds(Self.moveAnimationDuration))
            guard self.activeMoveAnimation?.move == move else { return }
            self.activeMoveAnimation = nil
            self.notifyChange()
        }
    }

    private func maybePlayBotMove() {
        guard mode == .vsBot, game.activeColor == .black, game.result == .ongoing else { return }
        guard !isThinking else {
            BotLogging.debug("maybePlayBotMove: skipped, already thinking")
            return
        }
        isThinking = true
        botEngineError = nil
        BotLogging.debug("maybePlayBotMove: started ply=\(game.recordedMoves.count)")

        Task { @MainActor in
            defer {
                self.isThinking = false
                BotLogging.debug("maybePlayBotMove: finished thinking flag cleared")
            }

            await self.waitForMoveAnimationToFinish()

            guard self.mode == .vsBot,
                  self.game.activeColor == .black,
                  self.game.result == .ongoing else {
                BotLogging.debug("maybePlayBotMove: aborted after animation (game state changed)")
                return
            }

            let difficulty = self.botDifficulty
            let currentGame = self.game.copy()
            let minimumDelay = difficulty.minimumThinkingDuration

            let clock = ContinuousClock()
            let start = clock.now
            let move = await BotProvider.player().chooseMove(in: currentGame, difficulty: difficulty)
            let elapsed = start.duration(to: clock.now)
            if elapsed < minimumDelay {
                try? await Task.sleep(for: minimumDelay - elapsed)
            }

            guard self.mode == .vsBot,
                  self.game.activeColor == .black,
                  self.game.result == .ongoing else {
                BotLogging.debug("maybePlayBotMove: aborted before apply (game state changed)")
                return
            }

            if let move, let piece = self.game.piece(at: move.from), self.game.applyMove(move) {
                BotLogging.debug("maybePlayBotMove: applied \(move.uci)")
                self.beginMoveAnimation(move: move, piece: piece)
                self.notifyChange()
                return
            }

            BotLogging.debug("maybePlayBotMove: no move applied")
            #if os(iOS)
            self.botEngineError = "Bot engine unavailable. Try again in a moment."
            #else
            self.botEngineError = "Bot engine unavailable."
            #endif
            self.notifyChange()
        }
    }

    private func waitForMoveAnimationToFinish() async {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: Self.animationWaitTimeout)
        while activeMoveAnimation != nil, clock.now < deadline {
            try? await Task.sleep(for: .milliseconds(16))
        }
        if activeMoveAnimation != nil {
            BotLogging.debug("waitForMoveAnimation: timed out, clearing stale animation")
            activeMoveAnimation = nil
            notifyChange()
        }
    }

    var statusText: String {
        switch result {
        case .ongoing:
            if let botEngineError, mode == .vsBot {
                return botEngineError
            }
            if isBrowsingHistory {
                return "Reviewing move \(displayedPly) of \(livePly)"
            }
            if isThinking { return "Bot is thinking…" }
            if game.isInCheck(color: game.activeColor) {
                return game.activeColor == .white ? "White is in check" : "Black is in check"
            }
            return game.activeColor == .white ? "White to move" : "Black to move"
        case .checkmate(let winner):
            return winner == .white ? "Checkmate — White wins" : "Checkmate — Black wins"
        case .resignation(let winner):
            return winner == .white ? "Black resigned — White wins" : "White resigned — Black wins"
        case .stalemate:
            return "Stalemate — Draw"
        case .draw(let reason):
            return "Draw — \(reason)"
        }
    }

    private func notifyChange() {
        boardRevision += 1
        if mode == .localTwoPlayer, !isBrowsingHistory {
            boardFlipped = game.activeColor == .black
        }
        objectWillChange.send()
    }

    private func playSelectionHaptic() {
        #if canImport(UIKit)
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
        #endif
    }
}
