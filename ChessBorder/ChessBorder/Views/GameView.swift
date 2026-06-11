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

    init(mode: GameMode, difficulty: BotDifficulty = .medium) {
        _viewModel = StateObject(wrappedValue: GameViewModel(mode: mode, botDifficulty: difficulty))
        onReturnHome = nil
    }

    init(saved: SavedGameSnapshot, onReturnHome: @escaping () -> Void) {
        _viewModel = StateObject(wrappedValue: GameViewModel(saved: saved))
        self.onReturnHome = onReturnHome
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

                    ZStack {
                        BoardView(viewModel: viewModel, boardSide: boardSide)
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

                if viewModel.result != .ongoing, !gameOverDismissed {
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
                subtitle: viewModel.mode == .vsBot ? "Fairy-Stockfish" : nil
            )
        } trailing: {
            HStack(spacing: 12) {
                if viewModel.mode == .localTwoPlayer {
                    GameNavTextAction(
                        title: "Auto-flip",
                        active: viewModel.autoFlipBoard,
                        action: { viewModel.toggleAutoFlipBoard() }
                    )
                }
                GameNavTextAction(
                    title: "Flip",
                    disabled: viewModel.mode == .localTwoPlayer && viewModel.autoFlipBoard,
                    action: { viewModel.toggleBoardFlip() }
                )
                GameNavIconAction(
                    systemName: viewModel.isComputingHint ? "lightbulb.fill" : "lightbulb",
                    active: viewModel.hintMove != nil || viewModel.isComputingHint,
                    disabled: viewModel.isComputingHint || !viewModel.canRequestHint,
                    action: { viewModel.requestHint() }
                )
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
        switch viewModel.mode {
        case .vsBot:
            return "Play vs Bot (\(viewModel.botDifficulty.rawValue))"
        case .localTwoPlayer:
            return "Play with Friend"
        }
    }

    // MARK: - Bottom panel

    private var bottomPanel: some View {
        VStack(spacing: 10) {
            if viewModel.canRetryBot {
                Button("Retry bot move") { viewModel.retryBotMove() }
                    .buttonStyle(GameChromeButtonStyle(variant: .primary))
            }

            if !viewModel.recordedMoves.isEmpty {
                GameSurfaceCard {
                    MoveListView(
                        moves: viewModel.recordedMoves,
                        selectedPly: displayedPly,
                        livePly: viewModel.livePly,
                        onSelect: { viewModel.goToMove(ply: $0) }
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
                if viewModel.livePly > 0 {
                    GameToolStripButton(
                        content: .icon("arrow.uturn.backward"),
                        disabled: viewModel.isBrowsingHistory || viewModel.isThinking,
                        action: { viewModel.undo() }
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
                    content: .text("Live"),
                    disabled: !viewModel.isBrowsingHistory,
                    action: { viewModel.returnToLivePosition() }
                )
            }
            .frame(maxWidth: .infinity)

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
