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
    /// Pass-and-play: rotate board for the side to move (default on).
    @Published var autoFlipBoard = true
    @Published var previewPly: Int?
    @Published var activeMoveAnimation: ActiveMoveAnimation?
    @Published private(set) var botEngineError: String?

    let mode: GameMode
    let botDifficulty: BotDifficulty

    private static let moveAnimationDuration: TimeInterval = 0.32
    private static let animationWaitTimeout: Duration = .seconds(2)
    /// Must exceed remote URLSession timeout (15s) plus local engine/minimax fallback.
    private static let botMoveTimeout: Duration = .seconds(35)

    private var botMoveToken = 0

    init(mode: GameMode, botDifficulty: BotDifficulty = .medium) {
        self.mode = mode
        self.botDifficulty = botDifficulty
    }

    init(saved: SavedGameSnapshot) {
        self.mode = saved.gameMode ?? .vsBot
        self.botDifficulty = saved.difficulty ?? .medium
        if let restored = SavedGameStore.restoreGame(from: saved) {
            self.game = restored
        }
        self.boardFlipped = saved.boardFlipped
        self.autoFlipBoard = saved.autoFlipBoard
    }

    func finishRestoringSavedGameIfNeeded() {
        guard mode == .vsBot, isBotTurn else { return }
        maybePlayBotMove()
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
        guard mode == .vsBot,
              botEngineError != nil,
              game.result == .ongoing,
              !isThinking,
              !isBrowsingHistory else {
            return false
        }
        if game.activeColor == .black { return true }
        let last = game.recordedMoves.last
        return game.activeColor == .white && last?.color == .black
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
        cancelBotRequest()
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
        cancelBotRequest()
        SavedGameStore.clear()
        game = ChessGame()
        clearSelection()
        pendingPromotion = nil
        isThinking = false
        boardFlipped = false
        autoFlipBoard = true
        previewPly = nil
        activeMoveAnimation = nil
        botEngineError = nil
        notifyChange()
    }

    func toggleBoardFlip() {
        boardFlipped.toggle()
        persistIfNeeded()
    }

    func toggleAutoFlipBoard() {
        autoFlipBoard.toggle()
        if autoFlipBoard, mode == .localTwoPlayer, !isBrowsingHistory {
            boardFlipped = game.activeColor == .black
        }
        notifyChange()
    }

    func retryBotMove() {
        guard canRetryBot else { return }
        botEngineError = nil
        if game.activeColor == .white {
            _ = game.undoLastMove()
            activeMoveAnimation = nil
            notifyChange()
        }
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

    private func cancelBotRequest() {
        botMoveToken += 1
        isThinking = false
    }

    private func maybePlayBotMove() {
        guard mode == .vsBot, game.activeColor == .black, game.result == .ongoing else { return }
        guard !isThinking else {
            BotLogging.debug("maybePlayBotMove: skipped, already thinking")
            return
        }

        let token = botMoveToken + 1
        botMoveToken = token
        isThinking = true
        botEngineError = nil
        BotLogging.debug("maybePlayBotMove: started ply=\(game.recordedMoves.count) token=\(token)")

        Task { @MainActor in
            defer {
                if self.botMoveToken == token {
                    self.isThinking = false
                    BotLogging.debug("maybePlayBotMove: finished thinking flag cleared")
                }
            }

            await self.waitForMoveAnimationToFinish()

            guard token == self.botMoveToken,
                  self.mode == .vsBot,
                  self.game.activeColor == .black,
                  self.game.result == .ongoing else {
                BotLogging.debug("maybePlayBotMove: aborted after animation (game state changed)")
                return
            }

            let difficulty = self.botDifficulty
            let plyAtRequest = self.game.recordedMoves.count
            let minimumDelay = difficulty.minimumThinkingDuration
            let enginePlayer = HybridBotPlayer()

            let clock = ContinuousClock()
            let start = clock.now
            var applied = false
            var lastUci = ""
            var lastError: String?

            for _ in 0..<2 where !applied {
                guard token == self.botMoveToken,
                      self.mode == .vsBot,
                      self.game.activeColor == .black,
                      self.game.result == .ongoing,
                      self.game.recordedMoves.count == plyAtRequest else {
                    BotLogging.debug("maybePlayBotMove: aborted during engine attempt")
                    return
                }

                let attempt = await Self.chooseEngineMoveWithTimeout(
                    in: self.game,
                    difficulty: difficulty,
                    player: enginePlayer,
                    timeout: Self.botMoveTimeout
                )
                if let uci = attempt.lastUci {
                    lastUci = uci
                }
                if let error = attempt.lastError {
                    lastError = error
                }

                if let move = attempt.move,
                   let piece = self.game.piece(at: move.from),
                   self.game.applyMove(move) {
                    BotLogging.debug("maybePlayBotMove: applied \(move.uci)")
                    self.beginMoveAnimation(move: move, piece: piece)
                    applied = true
                }
            }

            let elapsed = start.duration(to: clock.now)
            if elapsed < minimumDelay {
                try? await Task.sleep(for: minimumDelay - elapsed)
            }

            guard token == self.botMoveToken,
                  self.mode == .vsBot,
                  self.game.activeColor == .black,
                  self.game.result == .ongoing,
                  self.game.recordedMoves.count == plyAtRequest else {
                BotLogging.debug("maybePlayBotMove: aborted before apply (game state changed)")
                return
            }

            if applied {
                self.notifyChange()
                return
            }

            if let fallback = pickFallbackMove(in: self.game),
               let piece = self.game.piece(at: fallback.from),
               self.game.applyMove(fallback) {
                BotLogging.debug("maybePlayBotMove: applied fallback \(fallback.uci)")
                self.beginMoveAnimation(move: fallback, piece: piece)
                if let lastError {
                    self.botEngineError = "\(lastError) — played a fallback move. Tap Retry Bot to try the server again."
                } else {
                    self.botEngineError = "Engine unavailable — played a fallback move. Tap Retry Bot for a stronger reply."
                }
                self.notifyChange()
                return
            }

            BotLogging.debug("maybePlayBotMove: no move applied")
            if !lastUci.isEmpty {
                self.botEngineError = "Engine move (\(lastUci)) was not legal here — try Undo or New Game."
            } else if let lastError {
                self.botEngineError = lastError
            } else {
                self.botEngineError = "Engine did not return a move. Try again."
            }
            self.notifyChange()
        }
    }

    private static func chooseEngineMoveWithTimeout(
        in game: ChessGame,
        difficulty: BotDifficulty,
        player: HybridBotPlayer,
        timeout: Duration
    ) async -> BotEngineAttempt {
        await withTaskGroup(of: BotEngineAttempt.self) { group in
            group.addTask {
                await player.chooseEngineMove(in: game, difficulty: difficulty)
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                BotLogging.debug("chooseEngineMoveWithTimeout: timed out after \(timeout)")
                return BotEngineAttempt(move: nil, lastUci: nil, lastError: "Engine request timed out")
            }
            let attempt = await group.next() ?? BotEngineAttempt(move: nil, lastUci: nil, lastError: nil)
            group.cancelAll()
            return attempt
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
        if mode == .localTwoPlayer, autoFlipBoard, !isBrowsingHistory {
            boardFlipped = game.activeColor == .black
        }
        persistIfNeeded()
        objectWillChange.send()
    }

    private func persistIfNeeded() {
        SavedGameStore.save(from: self)
    }

    private func playSelectionHaptic() {
        #if canImport(UIKit)
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
        #endif
    }
}
