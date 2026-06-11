import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

struct ActiveMoveAnimation: Equatable {
    let move: Move
    let piece: Piece
}

@MainActor
final class GameViewModel: ObservableObject, BoardModel {
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
    @Published var soundMuted = ChessSoundPlayer.shared.isMuted
    /// Suggested move highlighted by the Hint button (cleared on the next move).
    @Published private(set) var hintMove: Move?
    @Published private(set) var isComputingHint = false

    // Coach state
    @Published private(set) var coachEval: PositionEval?
    @Published private(set) var coachBanner: CoachBannerInfo?
    @Published private(set) var coachHintWhy: String?
    private var coachToken = 0
    private var coachEvalByPly: [Int: PositionEval] = [:]
    private var coachBestByPly: [Int: (best: String?, pv: [String])] = [:]

    struct CoachBannerInfo {
        let classification: MoveClassification
        let text: String
        let ply: Int
    }

    func dismissCoachBanner() {
        coachBanner = nil
        objectWillChange.send()
    }

    // Review state
    @Published private(set) var review: ReviewResult?
    @Published private(set) var reviewProgress: (done: Int, total: Int)?
    private var reviewTask: Task<Void, Never>?

    var canStartReview: Bool {
        game.result != .ongoing && review == nil && reviewProgress == nil
    }

    func startReview() {
        guard canStartReview else { return }
        let movesUci = game.recordedMoves.map { $0.move.uci }
        reviewTask = Task { @MainActor in
            self.reviewProgress = (done: 0, total: movesUci.count)
            self.objectWillChange.send()
            let result = await analyzeGameReview(moves: movesUci, onProgress: { done, total in
                Task { @MainActor in
                    self.reviewProgress = (done: done, total: total)
                    self.objectWillChange.send()
                }
            })
            self.review = result
            self.reviewProgress = nil
            self.objectWillChange.send()
        }
    }

    func cancelReview() {
        reviewTask?.cancel()
        reviewTask = nil
        reviewProgress = nil
        objectWillChange.send()
    }

    let mode: GameMode
    let botDifficulty: BotDifficulty
    /// True when this view model is browsing a completed record (no bot, no persistence).
    let isReplay: Bool

    /// Hints are always computed at full strength so the suggestion is genuinely good.
    private static let hintDifficulty: BotDifficulty = .hard
    private var hintToken = 0

    private let sound = ChessSoundPlayer.shared

    private static let moveAnimationDuration: TimeInterval = 0.32
    private static let animationWaitTimeout: Duration = .seconds(2)
    /// Must exceed remote URLSession timeout (15s) plus local engine/minimax fallback.
    private static let botMoveTimeout: Duration = .seconds(35)

    private var botMoveToken = 0
    /// Set true the first time a completed game is appended to history; reset in newGame().
    private var historyRecorded = false

    init(mode: GameMode, botDifficulty: BotDifficulty = .medium) {
        self.mode = mode
        self.botDifficulty = botDifficulty
        self.isReplay = false
    }

    init(saved: SavedGameSnapshot) {
        self.mode = saved.gameMode ?? .vsBot
        self.botDifficulty = saved.difficulty ?? .medium
        self.isReplay = false
        if let restored = SavedGameStore.restoreGame(from: saved) {
            self.game = restored
        }
        self.boardFlipped = saved.boardFlipped
        self.autoFlipBoard = saved.autoFlipBoard
    }

    /// Browse-only replay of a completed game. No bot, no persistence.
    init(replay record: CompletedGameRecord) {
        self.mode = .localTwoPlayer   // never schedules the bot
        self.botDifficulty = .medium
        self.isReplay = true
        let game = ChessGame()
        for uci in record.moves {
            guard let move = game.move(from: uci) ?? game.move(fromEngineUCI: uci), game.applyMove(move) else { break }
        }
        if record.resultType == "resignation", let winner = record.winner {
            game.resign(by: winner == "white" ? .black : .white)
        }
        self.game = game
        self.boardFlipped = record.playerColor == "black"
        self.autoFlipBoard = false
    }

    func finishRestoringSavedGameIfNeeded() {
        // Record a finished restored game into history (dedupe makes this a no-op if
        // the game was already recorded in a previous session).
        recordHistoryIfFinished()
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

    var canRequestHint: Bool {
        canInteract && pendingPromotion == nil
    }

    func isHintSquare(_ square: Square) -> Bool {
        guard let hintMove else { return false }
        return hintMove.from == square || hintMove.to == square
    }

    /// Compute a strong suggested move for the side to move and highlight it.
    func requestHint() {
        guard !isComputingHint, canRequestHint else { return }

        let token = hintToken + 1
        hintToken = token
        hintMove = nil
        isComputingHint = true
        objectWillChange.send()

        let plyAtRequest = game.recordedMoves.count
        let snapshot = game.copy()
        let currentFen = game.toFEN()
        let moverColor = game.activeColor
        Task { @MainActor in
            let move = await HybridBotPlayer().chooseMove(in: snapshot, difficulty: Self.hintDifficulty)
            guard token == self.hintToken else { return }
            self.isComputingHint = false
            if self.game.recordedMoves.count == plyAtRequest {
                self.hintMove = move
                // Compute hint why from cached eval
                if let move, let cachedEval = self.coachEvalByPly[plyAtRequest] {
                    self.coachHintWhy = hintWhy(fen: currentFen, bestUci: move.uci, evalAtPosition: cachedEval, mover: moverColor)
                }
            }
            self.objectWillChange.send()
        }
    }

    /// Drop any active hint highlight and cancel a pending hint computation.
    private func clearHint() {
        hintToken += 1
        hintMove = nil
        isComputingHint = false
        coachHintWhy = nil
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
                sound.play(.illegal)
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
            clearHint()
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

        let fenBefore = game.toFEN()
        let plyBefore = game.recordedMoves.count
        let moverColor = game.activeColor

        guard game.applyMove(move) else { return false }

        emitMoveSound(for: move)
        previewPly = nil
        clearHint()
        clearSelection()
        beginMoveAnimation(move: move, piece: piece)
        notifyChange()

        let plyAfter = plyBefore + 1
        let shouldClassify = (mode == .vsBot && moverColor == .white) || mode == .localTwoPlayer
        analyzeCurrentPosition(ply: plyAfter, lastMove: move, fenBefore: fenBefore, mover: moverColor, shouldClassify: shouldClassify)

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
        let fenBefore = game.toFEN()
        let plyBefore = game.recordedMoves.count
        let moverColor = game.activeColor
        guard game.applyMove(move) else { return }
        emitMoveSound(for: move)
        previewPly = nil
        clearHint()
        clearSelection()
        beginMoveAnimation(move: move, piece: Piece(kind: kind, color: pawn.color))
        notifyChange()
        let plyAfter = plyBefore + 1
        let shouldClassify = (mode == .vsBot && moverColor == .white) || mode == .localTwoPlayer
        analyzeCurrentPosition(ply: plyAfter, lastMove: move, fenBefore: fenBefore, mover: moverColor, shouldClassify: shouldClassify)
        maybePlayBotMove()
    }

    func cancelPromotion() {
        pendingPromotion = nil
        clearSelection()
    }

    func undo() {
        cancelBotRequest()
        // Roll back to the player's turn. If the bot already replied that's two
        // plies (your move + its reply); if it's still thinking it's just your
        // move. Undoing a fixed 2 would overshoot into the bot's turn and leave
        // the status stuck on "thinking", so stop as soon as it's white's turn.
        let maxUndo = mode == .vsBot ? 2 : 1
        var undone = false
        for _ in 0..<maxUndo {
            guard game.undoLastMove() else { break }
            undone = true
            if mode == .vsBot, game.activeColor == .white { break }
        }
        if undone {
            activeMoveAnimation = nil
            returnToLivePosition()
            botEngineError = nil
            clearHint()
            notifyChange()
        }
        clearSelection()
    }

    func resignGame() {
        game.resign(by: game.activeColor)
        sound.play(.gameEnd)
        clearHint()
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
        historyRecorded = false
        clearHint()
        coachEval = nil
        coachBanner = nil
        coachHintWhy = nil
        coachToken += 1
        coachEvalByPly = [:]
        coachBestByPly = [:]
        review = nil
        reviewProgress = nil
        reviewTask?.cancel()
        reviewTask = nil
        notifyChange()
        sound.play(.gameStart)
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
            var appliedMove: Move?
            var fenBeforeBot: String?

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
                   let piece = self.game.piece(at: move.from) {
                    fenBeforeBot = self.game.toFEN()
                    if self.game.applyMove(move) {
                        BotLogging.debug("maybePlayBotMove: applied \(move.uci)")
                        self.emitMoveSound(for: move)
                        self.beginMoveAnimation(move: move, piece: piece)
                        appliedMove = move
                        applied = true
                    }
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
                let botPly = plyAtRequest + 1
                self.analyzeCurrentPosition(ply: botPly, lastMove: appliedMove, fenBefore: fenBeforeBot, mover: .black, shouldClassify: self.mode == .localTwoPlayer)
                return
            }

            if let fallback = pickFallbackMove(in: self.game, difficulty: difficulty),
               let piece = self.game.piece(at: fallback.from) {
                let fenBeforeFallback = self.game.toFEN()
                if self.game.applyMove(fallback) {
                    self.emitMoveSound(for: fallback)
                    BotLogging.debug("maybePlayBotMove: applied fallback \(fallback.uci)")
                    if let lastError {
                        BotLogging.debug("maybePlayBotMove: engine unavailable (\(lastError))")
                    } else {
                        BotLogging.debug("maybePlayBotMove: engine unavailable (no move from server/local engine)")
                    }
                    self.beginMoveAnimation(move: fallback, piece: piece)
                    self.notifyChange()
                    let botPly = plyAtRequest + 1
                    self.analyzeCurrentPosition(ply: botPly, lastMove: fallback, fenBefore: fenBeforeFallback, mover: .black, shouldClassify: self.mode == .localTwoPlayer)
                    return
                }
            }

            BotLogging.debug("maybePlayBotMove: no move applied")
            if !lastUci.isEmpty {
                self.botEngineError = "Engine move (\(lastUci)) was not legal here. Try Undo or New Game."
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
            return winner == .white ? "Checkmate. White wins" : "Checkmate. Black wins"
        case .resignation(let winner):
            return winner == .white ? "Black resigned. White wins" : "White resigned. Black wins"
        case .stalemate:
            return "Stalemate. Draw"
        case .draw(let reason):
            return "Draw: \(reason)"
        }
    }

    private func analyzeCurrentPosition(
        ply: Int,
        lastMove: Move?,
        fenBefore: String?,
        mover: PieceColor?,
        shouldClassify: Bool
    ) {
        // Guards
        guard !isReplay else { return }
        guard UserDefaults.standard.bool(forKey: "coachEnabled") else { return }

        let token = coachToken + 1
        coachToken = token
        let gameCopy = game.copy()

        Task { @MainActor in
            guard token == self.coachToken else { return }

            let analysis = await AnalyzeService.shared.analyse(in: gameCopy, movetimeMs: AnalyzeService.liveMovetimeMs)
            guard token == self.coachToken else { return }

            if let analysis {
                let wrel = toWhiteRelative(scoreCp: analysis.scoreCp, mateIn: analysis.mateIn, sideToMove: gameCopy.activeColor)
                self.coachEval = wrel
                self.coachEvalByPly[ply] = wrel
                self.coachBestByPly[ply] = (best: analysis.bestMoveUci, pv: analysis.pv)

                // Classify the last move if we can
                if shouldClassify, let mover, let prevEval = self.coachEvalByPly[ply - 1] {
                    let classification = classifyMove(before: prevEval, after: wrel, mover: mover)
                    if classification == .mistake || classification == .blunder {
                        if let lastMove, let fen = fenBefore {
                            let prevBest = self.coachBestByPly[ply - 1]
                            let input = ExplainInput(
                                fen: fen,
                                movePlayed: lastMove.uci,
                                bestMoveUci: prevBest?.best,
                                pv: prevBest?.pv ?? [],
                                before: prevEval,
                                after: wrel,
                                classification: classification,
                                mover: mover
                            )
                            let explanation = explainMove(input)
                            self.coachBanner = CoachBannerInfo(
                                classification: classification,
                                text: explanation,
                                ply: ply
                            )
                        }
                    }
                }

                self.objectWillChange.send()
            }
        }
    }

    private func notifyChange() {
        boardRevision += 1
        if mode == .localTwoPlayer, autoFlipBoard, !isBrowsingHistory {
            boardFlipped = game.activeColor == .black
        }
        persistIfNeeded()
        recordHistoryIfFinished()
        objectWillChange.send()
    }

    private func persistIfNeeded() {
        guard !isReplay else { return }
        SavedGameStore.save(from: self)
    }

    func recordHistoryIfFinished() {
        guard !isReplay, !historyRecorded, game.result != .ongoing else { return }
        historyRecorded = true
        guard let record = completedRecord() else { return }
        if GameHistoryStore.append(record) {
            GameUploadQueue.enqueueAndFlush(record)
        }
    }

    private func completedRecord() -> CompletedGameRecord? {
        let (resultType, winner): (String, String?) = {
            switch game.result {
            case .ongoing: return ("", nil)
            case .checkmate(let w): return ("checkmate", w == .white ? "white" : "black")
            case .resignation(let w): return ("resignation", w == .white ? "white" : "black")
            case .stalemate: return ("stalemate", nil)
            case .draw: return ("draw", nil)
            }
        }()
        guard !resultType.isEmpty else { return nil }
        let vsBot = mode == .vsBot
        return CompletedGameRecord(
            gameId: UUID().uuidString,
            mode: vsBot ? "vsBot" : "localTwoPlayer",
            difficulty: vsBot ? botDifficulty.rawValue.lowercased() : nil,
            playerColor: vsBot ? "white" : nil,
            opponent: vsBot ? "Bot (\(botDifficulty.rawValue.lowercased()))" : "Friend (local)",
            moves: game.recordedMoves.map(\.move.uci),
            resultType: resultType,
            winner: winner,
            endedAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    private func playSelectionHaptic() {
        #if canImport(UIKit)
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
        #endif
    }

    func toggleSound() {
        soundMuted = sound.toggleMuted()
    }

    /// Classify a just-applied move and play its sound cue.
    private func emitMoveSound(for move: Move) {
        let result = game.result
        let captured = game.recordedMoves.last?.captured != nil
        let givesCheck = result == .ongoing && game.isInCheck(color: game.activeColor)
        sound.play(classifyMoveSound(result: result, givesCheck: givesCheck, captured: captured, move: move))
    }
}
