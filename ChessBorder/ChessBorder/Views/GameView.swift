import SwiftUI

struct PromotionPickerView: View {
    let color: PieceColor
    let onSelect: (PieceKind) -> Void
    let onCancel: () -> Void

    private let options: [PieceKind] = [.queen, .rook, .bishop, .knight]

    var body: some View {
        VStack(spacing: 16) {
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
                            .background(Color.white.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
            }

            Button("Cancel", action: onCancel)
                .foregroundStyle(BoardTheme.accent)
        }
        .padding(24)
        .background(BoardTheme.background.opacity(0.95))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.white.opacity(0.15), lineWidth: 1)
        )
    }
}

struct GameView: View {
    @StateObject private var viewModel: GameViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var showResignConfirm = false
    @State private var gameOverDismissed = false
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

                VStack(spacing: 6) {
                    header

                    if hasCaptures {
                        CapturedPiecesBar(
                            capturedByWhite: viewModel.capturedByWhite,
                            capturedByBlack: viewModel.capturedByBlack
                        )
                    }

                    Text(viewModel.statusText)
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.65))
                        .multilineTextAlignment(.center)
                        .frame(minHeight: 18)

                    BoardView(viewModel: viewModel, boardSide: boardSide)

                    Spacer(minLength: 0)

                    if !viewModel.recordedMoves.isEmpty {
                        MoveListView(
                            moves: viewModel.recordedMoves,
                            selectedPly: displayedPly,
                            livePly: viewModel.livePly,
                            onSelect: { viewModel.goToMove(ply: $0) }
                        )
                        .padding(.horizontal, 4)
                        .padding(.vertical, 6)
                        .background(Color.white.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }

                    gameControls
                }
                .padding(.horizontal, GameBoardLayout.horizontalInset)
                .padding(.bottom, 6)
                .safeAreaPadding(.top, 2)

                if viewModel.pendingPromotion != nil {
                    Color.black.opacity(0.5).ignoresSafeArea()
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
        .onAppear {
            viewModel.finishRestoringSavedGameIfNeeded()
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Button {
                if let onReturnHome {
                    onReturnHome()
                } else {
                    dismiss()
                }
            } label: {
                Text("← Back")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.white.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }

            Spacer(minLength: 8)

            Text(headerTitle)
                .font(.headline)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.85)

            Spacer(minLength: 8)

            if viewModel.mode == .localTwoPlayer {
                Button { viewModel.toggleAutoFlipBoard() } label: {
                    Text("Auto-flip")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(viewModel.autoFlipBoard ? BoardTheme.accent : .white.opacity(0.6))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                }
            }

            Button { viewModel.toggleBoardFlip() } label: {
                Text("Flip")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(
                        viewModel.mode == .localTwoPlayer && viewModel.autoFlipBoard
                            ? Color.white.opacity(0.35)
                            : Color.white
                    )
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.white.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .disabled(viewModel.mode == .localTwoPlayer && viewModel.autoFlipBoard)
        }
        .padding(.top, 2)
    }

    private var headerTitle: String {
        switch viewModel.mode {
        case .vsBot:
            return "Play vs Bot (\(viewModel.botDifficulty.rawValue.lowercased()))"
        case .localTwoPlayer:
            return "Play with Friend"
        }
    }

    private var gameControls: some View {
        VStack(spacing: 10) {
            if viewModel.canRetryBot {
                Button("Retry Bot Move") { viewModel.retryBotMove() }
                    .buttonStyle(PrimaryGameButtonStyle())
                    .frame(maxWidth: .infinity)
            }

            HStack(spacing: 8) {
                if viewModel.livePly > 0 {
                    controlButton("Undo") { viewModel.undo() }
                        .disabled(viewModel.isBrowsingHistory || viewModel.isThinking)
                }

                controlButton("◀") { viewModel.stepBack() }
                    .disabled(displayedPly == 0)

                controlButton("▶") { viewModel.stepForward() }
                    .disabled(displayedPly >= viewModel.livePly)

                controlButton("Live") {
                    if viewModel.isBrowsingHistory {
                        viewModel.returnToLivePosition()
                    }
                }
                .disabled(!viewModel.isBrowsingHistory)

                controlButton("Resign", role: .destructive) { showResignConfirm = true }
                    .disabled(viewModel.result != .ongoing)

                Button {
                    gameOverDismissed = false
                    viewModel.newGame()
                } label: {
                    Text("New Game")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(BoardTheme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
        }
    }

    private enum ControlButtonRole {
        case normal
        case destructive
    }

    private func controlButton(
        _ title: String,
        role: ControlButtonRole = .normal,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(role == .destructive ? Color(red: 1, green: 0.7, blue: 0.7) : .white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(role == .destructive ? Color(red: 0.36, green: 0.16, blue: 0.16) : Color.white.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }

    @ViewBuilder
    private var gameOverOverlay: some View {
        VStack(spacing: 16) {
            Text(viewModel.statusText)
                .font(.title2.bold())
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)

            HStack(spacing: 12) {
                Button("New Game") {
                    gameOverDismissed = false
                    viewModel.newGame()
                }
                    .buttonStyle(PrimaryGameButtonStyle())
                Button("Dismiss") {
                    gameOverDismissed = true
                }
                    .buttonStyle(SecondaryGameButtonStyle())
                Button("Home") {
                    if let onReturnHome {
                        onReturnHome()
                    } else {
                        dismiss()
                    }
                }
                    .buttonStyle(SecondaryGameButtonStyle())
            }
        }
        .padding(28)
        .background(BoardTheme.background.opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(BoardTheme.accent.opacity(0.4), lineWidth: 1)
        )
        .padding(32)
    }
}

struct PrimaryGameButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(.black)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(BoardTheme.accent.opacity(configuration.isPressed ? 0.75 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

struct SecondaryGameButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color.white.opacity(configuration.isPressed ? 0.12 : 0.18))
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
