import SwiftUI

@MainActor
final class OnlineGameViewModel: ObservableObject, BoardModel {
    @Published private(set) var state: OnlineState?
    @Published private(set) var connection: OnlineSocket.Status = .connecting
    @Published private(set) var lastError: String?
    @Published var selectedSquare: Square?
    @Published private(set) var legalTargets: Set<Square> = []
    @Published private(set) var captureTargets: Set<Square> = []
    @Published var previewPly: Int?
    @Published var soundMuted = ChessSoundPlayer.shared.isMuted

    let roomId: String

    private let identityToken: String
    private let identityName: String
    private var game = ChessGame()
    private var previewSnapshot: GameSnapshot?
    /// True between an optimistic local move and the server's authoritative echo.
    private var pendingMove = false
    private var firstState = true
    private var socket: OnlineSocket?
    private let sound = ChessSoundPlayer.shared

    init(roomId: String) {
        self.roomId = roomId
        self.identityToken = OnlineIdentity.token
        self.identityName = OnlineIdentity.name

        guard let url = MultiplayerConfig.serverURL else { return }
        let socket = OnlineSocket(url: url)
        socket.onStatus = { [weak self] status in
            self?.connection = status
            self?.objectWillChange.send()
        }
        socket.onOpen = { [weak self] in
            guard let self else { return }
            self.socket?.send(.join(roomId: self.roomId, token: self.identityToken, name: self.identityName))
        }
        socket.onMessage = { [weak self] message in
            self?.handle(message)
        }
        self.socket = socket
    }

    var isConfigured: Bool { socket != nil }

    func start() {
        socket?.connect()
    }

    func dispose() {
        socket?.close()
    }

    // MARK: - Derived state

    var role: OnlineRole? { state?.role }
    var status: String? { state?.status }
    var pieceColor: PieceColor? { state?.pieceColor }
    var yourTurn: Bool { state?.yourTurn ?? false }
    var livePly: Int { state?.moves.count ?? 0 }
    var displayedPly: Int { previewPly ?? livePly }
    var recordedMoves: [RecordedMove] { game.recordedMoves }
    var isBrowsingHistory: Bool {
        guard let previewPly else { return false }
        return previewPly < livePly
    }
    var canMove: Bool {
        status == "active" && yourTurn && pieceColor != nil && !pendingMove && !isBrowsingHistory
    }
    var shareURL: URL? { MultiplayerConfig.shareURL(roomId: roomId) }

    // MARK: - BoardModel

    var boardFlipped: Bool { pieceColor == .black }
    var activeMoveAnimation: ActiveMoveAnimation? { nil }

    func piece(at square: Square) -> Piece? {
        if isBrowsingHistory, let snap = previewSnapshot {
            return snap.piece(at: square)
        }
        return game.piece(at: square)
    }
    func isSelected(_ square: Square) -> Bool { selectedSquare == square }
    func isLegalTarget(_ square: Square) -> Bool { legalTargets.contains(square) }
    func isCaptureTarget(_ square: Square) -> Bool { captureTargets.contains(square) }
    func isHintSquare(_ square: Square) -> Bool { false }
    func isAnimatingMove(from square: Square) -> Bool { false }
    func isAnimatingMove(to square: Square) -> Bool { false }

    func isLastMoveSquare(_ square: Square) -> Bool {
        let lm = isBrowsingHistory ? previewSnapshot?.lastMove : game.lastMove
        guard let lm else { return false }
        return lm.from == square || lm.to == square
    }

    func isKingInCheck(_ square: Square) -> Bool {
        guard !isBrowsingHistory else { return false }
        guard let piece = game.piece(at: square), piece.kind == .king else { return false }
        return game.isInCheck(color: piece.color) && game.activeColor == piece.color
    }

    func squareBackgroundColor(_ square: Square) -> Color {
        let isLight = (square.row + square.col) % 2 == 0
        if BoardConstants.isBorder(row: square.row, col: square.col) {
            return isLight ? BoardTheme.borderLightSquare : BoardTheme.borderDarkSquare
        }
        return isLight ? BoardTheme.lightSquare : BoardTheme.darkSquare
    }

    func handleSquareTap(_ square: Square) {
        guard canMove, let myColor = pieceColor else { return }

        if let selected = selectedSquare {
            if selected == square {
                clearSelection()
                objectWillChange.send()
                return
            }
            if legalTargets.contains(square) {
                let candidates = game.legalMoves().filter { $0.from == selected && $0.to == square }
                let move = candidates.first { $0.promotion == .queen } ?? candidates.first
                if let move {
                    socket?.send(.move(uci: move.uci))
                    // Optimistic: apply locally for instant feedback; the server
                    // echo reconciles it (or an error reverts via resync()).
                    if game.applyMove(move) {
                        pendingMove = true
                    }
                    clearSelection()
                    objectWillChange.send()
                    return
                }
            }
            if let piece = game.piece(at: square), piece.color == myColor {
                select(square)
            } else {
                clearSelection()
            }
            objectWillChange.send()
            return
        }

        if let piece = game.piece(at: square), piece.color == myColor {
            select(square)
            objectWillChange.send()
        }
    }

    // MARK: - History

    func goToMove(ply: Int) {
        if ply >= livePly {
            returnToLive()
            return
        }
        previewPly = ply
        previewSnapshot = game.snapshot(atPly: ply)
        clearSelection()
        objectWillChange.send()
    }
    func returnToLive() {
        guard previewPly != nil else { return }
        previewPly = nil
        previewSnapshot = nil
        clearSelection()
        objectWillChange.send()
    }
    func stepBack() {
        goToMove(ply: max((previewPly ?? livePly) - 1, 0))
    }
    func stepForward() {
        let current = previewPly ?? livePly
        if current >= livePly { returnToLive() } else { goToMove(ply: current + 1) }
    }

    func requestRematch() {
        socket?.send(.rematch)
    }

    func toggleSound() {
        soundMuted = sound.toggleMuted()
    }

    // MARK: - Internals

    func handle(_ message: ServerMessage) {
        switch message {
        case .state(let s):
            applyState(s)
        case .error(let msg):
            lastError = msg
            pendingMove = false
            rebuild(prevCount: state?.moves.count ?? 0) // discard optimistic move
            objectWillChange.send()
        }
    }

    private func applyState(_ s: OnlineState) {
        let prevCount = firstState ? s.moves.count : (state?.moves.count ?? 0)
        lastError = nil
        pendingMove = false
        previewPly = nil
        previewSnapshot = nil
        state = s
        rebuild(prevCount: prevCount)
        firstState = false
        objectWillChange.send()
    }

    private func rebuild(prevCount: Int) {
        let moves = state?.moves ?? []
        let g = ChessGame()
        var capturedOnLast = false
        for (i, uci) in moves.enumerated() {
            guard let mv = resolveMove(uci, in: g) else { break }
            if i == moves.count - 1 {
                capturedOnLast = g.piece(at: mv.to) != nil || mv.isEnPassant
            }
            _ = g.applyMove(mv)
        }
        game = g
        clearSelection()

        if moves.count > prevCount, let lm = g.lastMove {
            let result = g.result
            let givesCheck = result == .ongoing && g.isInCheck(color: g.activeColor)
            sound.play(classifyMoveSound(result: result, givesCheck: givesCheck, captured: capturedOnLast, move: lm))
        } else if moves.isEmpty && prevCount > 0 {
            sound.play(.gameStart)
        }
    }

    private func resolveMove(_ uci: String, in game: ChessGame) -> Move? {
        game.move(from: uci) ?? game.move(fromEngineUCI: uci)
    }

    private func select(_ square: Square) {
        selectedSquare = square
        let moves = game.legalMoves().filter { $0.from == square }
        legalTargets = Set(moves.map(\.to))
        captureTargets = Set(
            moves.filter { game.piece(at: $0.to) != nil || $0.isEnPassant }.map(\.to)
        )
    }

    private func clearSelection() {
        selectedSquare = nil
        legalTargets = []
        captureTargets = []
    }
}
