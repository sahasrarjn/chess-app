import SwiftUI

struct PromotionPickerView: View {
    let color: PieceColor
    let onSelect: (PieceKind) -> Void
    let onCancel: () -> Void

    private let options: [PieceKind] = [.queen, .rook, .bishop, .knight]

    var body: some View {
        VStack(spacing: 20) {
            Text("Promote pawn")
                .font(.headline)
                .foregroundStyle(.white)

            HStack(spacing: 12) {
                ForEach(options, id: \.self) { kind in
                    Button {
                        onSelect(kind)
                    } label: {
                        PieceView(piece: Piece(kind: kind, color: color))
                            .frame(width: 56, height: 56)
                            .background(BoardTheme.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(BoardTheme.border, lineWidth: 1)
                            )
                    }
                }
            }

            Button("Cancel", action: onCancel)
                .buttonStyle(GameChromeButtonStyle(variant: .ghost))
                .frame(maxWidth: .infinity)
        }
        .padding(28)
        .background(BoardTheme.background.opacity(0.97))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(BoardTheme.border, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.5), radius: 24, y: 12)
        .padding(28)
    }
}

struct GameView: View {
    @StateObject private var viewModel: GameViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var showResignConfirm = false
    @State private var gameOverDismissed = false
    @State private var showSettings = false
    private let onReturnHome: (() -> Void)?
    private let isReplay: Bool

    init(mode: GameMode, difficulty: BotDifficulty = .medium) {
        _viewModel = StateObject(wrappedValue: GameViewModel(mode: mode, botDifficulty: difficulty))
        onReturnHome = nil
        isReplay = false
    }

    init(saved: SavedGameSnapshot, onReturnHome: @escaping () -> Void) {
        _viewModel = StateObject(wrappedValue: GameViewModel(saved: saved))
        self.onReturnHome = onReturnHome
        isReplay = false
    }

    init(replay record: CompletedGameRecord) {
        _viewModel = StateObject(wrappedValue: GameViewModel(replay: record))
        onReturnHome = nil
        isReplay = true
        _gameOverDismissed = State(initialValue: true)
    }

    private var displayedPly: Int {
        viewModel.previewPly ?? viewModel.livePly
    }

    private var hasCaptures: Bool {
        !viewModel.capturedByWhite.isEmpty || !viewModel.capturedByBlack.isEmpty
    }

    var body: some View {
        GeometryReader { geo in
            let boardSide = GameBoardLayout.boardSide(in: geo)

            ZStack {
                BoardTheme.background.ignoresSafeArea()

                VStack(spacing: 0) {
                    header
                        .padding(.horizontal, 12)
                        .padding(.top, 4)

                    if hasCaptures {
                        CapturedPiecesBar(
                            capturedByWhite: viewModel.capturedByWhite,
                            capturedByBlack: viewModel.capturedByBlack
                        )
                        .padding(.horizontal, 12)
                        .padding(.top, 6)
                    }

                    GameStatusPill(text: viewModel.statusText)
                        .padding(.horizontal, 12)
                        .padding(.top, 4)

                    if let banner = viewModel.coachBanner {
                        coachBannerView(banner: banner)
                            .padding(.horizontal, 12)
                            .padding(.top, 4)
                    }

                    if let why = viewModel.coachHintWhy, viewModel.hintMove != nil {
                        Text(why)
                            .font(.caption)
                            .foregroundStyle(BoardTheme.muted)
                            .padding(.horizontal, 12)
                    }

                    ZStack {
                        BoardView(viewModel: viewModel, boardSide: boardSide)

                        if UserDefaults.standard.bool(forKey: "coachEnabled"),
                           let eval = viewModel.coachEval {
                            evalBarView(eval: eval)
                                .frame(width: 12)
                                .padding(.trailing, 4)
                                .frame(maxWidth: .infinity, alignment: .trailing)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                    bottomPanel
                        .padding(.horizontal, 12)
                        .padding(.bottom, 8)
                }
                .safeAreaPadding(.bottom, 4)

                if viewModel.pendingPromotion != nil {
                    Color.black.opacity(0.55).ignoresSafeArea()
                    PromotionPickerView(
                        color: viewModel.game.activeColor,
                        onSelect: { viewModel.promote(to: $0) },
                        onCancel: { viewModel.cancelPromotion() }
                    )
                }

                if viewModel.result != .ongoing, !gameOverDismissed, !isReplay {
                    gameOverOverlay
                }
            }
        }
        .chessAppNavigationChromeHidden()
        .onChange(of: viewModel.result) { _, newResult in
            if newResult != .ongoing {
                gameOverDismissed = false
            }
        }
        .confirmationDialog("Resign this game?", isPresented: $showResignConfirm, titleVisibility: .visible) {
            Button("Resign", role: .destructive) {
                viewModel.resignGame()
            }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .presentationDetents([.medium, .large])
        }
        .onAppear {
            viewModel.finishRestoringSavedGameIfNeeded()
        }
    }

    // MARK: - Header

    private var header: some View {
        GameNavBar(backTitle: "Back", onBack: navigateBack) {
            GameNavTitle(
                title: headerTitle,
                subtitle: isReplay ? viewModel.game.recordedMoves.first.map { _ in headerSubtitle } : (viewModel.mode == .vsBot ? "Fairy-Stockfish" : nil)
            )
        } trailing: {
            HStack(spacing: 12) {
                if !isReplay, viewModel.mode == .localTwoPlayer {
                    GameNavTextAction(
                        title: "Auto-flip",
                        active: viewModel.autoFlipBoard,
                        action: { viewModel.toggleAutoFlipBoard() }
                    )
                }
                GameNavTextAction(
                    title: "Flip",
                    disabled: !isReplay && viewModel.mode == .localTwoPlayer && viewModel.autoFlipBoard,
                    action: { viewModel.toggleBoardFlip() }
                )
                if !isReplay {
                    GameNavIconAction(
                        systemName: viewModel.isComputingHint ? "lightbulb.fill" : "lightbulb",
                        active: viewModel.hintMove != nil || viewModel.isComputingHint,
                        disabled: viewModel.isComputingHint || !viewModel.canRequestHint,
                        action: { viewModel.requestHint() }
                    )
                }
                GameNavIconAction(
                    systemName: viewModel.soundMuted ? "speaker.slash.fill" : "speaker.wave.2.fill",
                    action: { viewModel.toggleSound() }
                )
                GameNavIconAction(
                    systemName: "gearshape",
                    action: { showSettings = true }
                )
            }
        }
    }

    private func navigateBack() {
        if let onReturnHome {
            onReturnHome()
        } else {
            dismiss()
        }
    }

    private var headerTitle: String {
        if isReplay { return "Replay" }
        switch viewModel.mode {
        case .vsBot:
            return "Play vs Bot (\(viewModel.botDifficulty.rawValue))"
        case .localTwoPlayer:
            return "Play with Friend"
        }
    }

    /// Subtitle shown under "Replay" in the header — the status text when game is done.
    private var headerSubtitle: String {
        viewModel.statusText
    }

    // MARK: - Bottom panel

    private var reviewClassifications: [Int: MoveClassification]? {
        guard let review = viewModel.review else { return nil }
        var dict: [Int: MoveClassification] = [:]
        for m in review.moves {
            dict[m.ply] = m.classification
        }
        return dict
    }

    private var bottomPanel: some View {
        VStack(spacing: 10) {
            if !isReplay, viewModel.canRetryBot {
                Button("Retry bot move") { viewModel.retryBotMove() }
                    .buttonStyle(GameChromeButtonStyle(variant: .primary))
            }

            // Review controls (available in replay mode too — that's the primary use case)
            if viewModel.result != .ongoing || viewModel.review != nil || viewModel.reviewProgress != nil {
                if viewModel.canStartReview {
                    Button("Analyze game") { viewModel.startReview() }
                        .buttonStyle(GameChromeButtonStyle(variant: .secondary))
                } else if let progress = viewModel.reviewProgress {
                    HStack(spacing: 8) {
                        ProgressView(value: Double(progress.done), total: Double(max(progress.total, 1)))
                            .frame(maxWidth: .infinity)
                        Text("\(progress.done)/\(progress.total)")
                            .font(.caption)
                            .foregroundStyle(BoardTheme.muted)
                        Button("Cancel") { viewModel.cancelReview() }
                            .font(.caption)
                            .foregroundStyle(BoardTheme.accent)
                    }
                } else if let review = viewModel.review {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("White \(review.accuracy.white)% · Black \(review.accuracy.black)%")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(BoardTheme.accent)
                        if !review.keyMoments.isEmpty {
                            Text("Key moments:")
                                .font(.caption2)
                                .foregroundStyle(BoardTheme.muted)
                            ForEach(Array(review.keyMoments.enumerated()), id: \.offset) { _, m in
                                Button("Move \(m.ply): \(m.uci) \(m.classification == .blunder ? "??" : "?")") {
                                    viewModel.goToMove(ply: m.ply)
                                }
                                .font(.caption2)
                                .foregroundStyle(BoardTheme.accent)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            if !viewModel.recordedMoves.isEmpty {
                GameSurfaceCard {
                    MoveListView(
                        moves: viewModel.recordedMoves,
                        selectedPly: displayedPly,
                        livePly: viewModel.livePly,
                        onSelect: { viewModel.goToMove(ply: $0) },
                        classifications: reviewClassifications
                    )
                    .padding(.vertical, 6)
                }
            }

            controlRow
        }
    }

    private var controlRow: some View {
        HStack(spacing: 10) {
            GameToolStrip {
                if !isReplay, viewModel.livePly > 0 {
                    GameToolStripButton(
                        content: .icon("arrow.uturn.backward"),
                        disabled: viewModel.isBrowsingHistory || viewModel.isThinking,
                        action: { viewModel.undo() }
                    )
                    GameToolStripDivider()
                }

                if isReplay {
                    GameToolStripButton(
                        content: .text("First"),
                        disabled: displayedPly == 0,
                        action: { viewModel.goToMove(ply: 0) }
                    )
                    GameToolStripDivider()
                }

                GameToolStripButton(
                    content: .icon("chevron.left"),
                    disabled: displayedPly == 0,
                    action: { viewModel.stepBack() }
                )
                GameToolStripDivider()
                GameToolStripButton(
                    content: .icon("chevron.right"),
                    disabled: displayedPly >= viewModel.livePly,
                    action: { viewModel.stepForward() }
                )
                GameToolStripDivider()
                GameToolStripButton(
                    content: .text(isReplay ? "Last" : "Live"),
                    disabled: !viewModel.isBrowsingHistory,
                    action: { viewModel.returnToLivePosition() }
                )
            }
            .frame(maxWidth: .infinity)

            if !isReplay {
                GameSecondaryAction(
                    title: "Resign",
                    disabled: viewModel.result != .ongoing,
                    action: { showResignConfirm = true }
                )

                GamePrimaryAction(title: "New Game") {
                    gameOverDismissed = false
                    viewModel.newGame()
                }
            }
        }
    }

    // MARK: - Coach views

    private func evalBarView(eval: PositionEval) -> some View {
        GeometryReader { geo in
            let fraction: Double = {
                if let m = eval.mateIn {
                    return m > 0 ? 1.0 : 0.0
                }
                let cp = Double(eval.cp ?? 0)
                return 1.0 / (1.0 + exp(-cp / 400.0))
            }()
            // White fills from bottom; fraction = white advantage
            ZStack(alignment: .bottom) {
                Capsule()
                    .fill(Color.black.opacity(0.5))
                Capsule()
                    .fill(Color.white)
                    .frame(height: geo.size.height * fraction)
            }
        }
        .clipShape(Capsule())
    }

    private func coachBannerView(banner: GameViewModel.CoachBannerInfo) -> some View {
        HStack(spacing: 8) {
            Image(systemName: banner.classification == .blunder ? "exclamationmark.triangle.fill" : "exclamationmark.circle.fill")
                .foregroundStyle(banner.classification == .blunder ? .red : .orange)
            Text(banner.text)
                .font(.caption)
                .foregroundStyle(.white)
                .multilineTextAlignment(.leading)
            Spacer()
            Button {
                viewModel.dismissCoachBanner()
            } label: {
                Image(systemName: "xmark")
                    .foregroundStyle(BoardTheme.muted)
                    .font(.caption)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(BoardTheme.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(banner.classification == .blunder ? Color.red.opacity(0.5) : Color.orange.opacity(0.5), lineWidth: 1)
        )
    }

    // MARK: - Game over

    private var gameOverOverlay: some View {
        VStack(spacing: 20) {
            Text(viewModel.statusText)
                .font(.title2.bold())
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)

            VStack(spacing: 10) {
                Button("New Game") {
                    gameOverDismissed = false
                    viewModel.newGame()
                }
                .buttonStyle(GameChromeButtonStyle(variant: .primary))

                if viewModel.canStartReview {
                    Button("Review") {
                        gameOverDismissed = true
                        viewModel.startReview()
                    }
                    .buttonStyle(GameChromeButtonStyle(variant: .secondary))
                }

                HStack(spacing: 10) {
                    Button("Dismiss") { gameOverDismissed = true }
                        .buttonStyle(GameChromeButtonStyle(variant: .secondary))
                        .frame(maxWidth: .infinity)
                    Button("Home") {
                        if let onReturnHome {
                            onReturnHome()
                        } else {
                            dismiss()
                        }
                    }
                    .buttonStyle(GameChromeButtonStyle(variant: .secondary))
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(28)
        .background(BoardTheme.background.opacity(0.97))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(BoardTheme.accent.opacity(0.35), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.45), radius: 20, y: 10)
        .padding(32)
    }
}
