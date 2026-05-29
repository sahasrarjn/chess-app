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

    var body: some View {
        ZStack {
            BoardTheme.background.ignoresSafeArea()

            VStack(spacing: 6) {
                header

                CapturedPiecesBar(
                    capturedByWhite: viewModel.capturedByWhite,
                    capturedByBlack: viewModel.capturedByBlack
                )
                .padding(.horizontal, 8)

                Text(viewModel.statusText)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(BoardTheme.accent)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 8)
                    .frame(minHeight: 20)

                BoardView(viewModel: viewModel)
                    .layoutPriority(1)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.horizontal, 2)

                if !viewModel.recordedMoves.isEmpty {
                    MoveListView(
                        moves: viewModel.recordedMoves,
                        selectedPly: displayedPly,
                        livePly: viewModel.livePly,
                        onSelect: { viewModel.goToMove(ply: $0) }
                    )
                    .frame(maxHeight: 72)
                    .padding(.horizontal, 8)
                }

                historyControls
                actionButtons
            }

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
        HStack {
            Button {
                if let onReturnHome {
                    onReturnHome()
                } else {
                    dismiss()
                }
            } label: {
                Image(systemName: "chevron.left")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.white)
            }

            Spacer()

            Text(viewModel.mode.rawValue)
                .font(.headline)
                .foregroundStyle(.white)

            if viewModel.mode == .localTwoPlayer {
                Button { viewModel.toggleAutoFlipBoard() } label: {
                    Text("Auto-flip")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(viewModel.autoFlipBoard ? BoardTheme.accent : .white.opacity(0.6))
                }
            }

            Button { viewModel.toggleBoardFlip() } label: {
                Image(systemName: "arrow.up.arrow.down")
                    .font(.title3)
                    .foregroundStyle(
                        viewModel.mode == .localTwoPlayer && viewModel.autoFlipBoard
                            ? Color.white.opacity(0.35)
                            : Color.white
                    )
            }
            .disabled(viewModel.mode == .localTwoPlayer && viewModel.autoFlipBoard)
        }
        .padding(.horizontal)
        .padding(.top, 4)
    }

    private var historyControls: some View {
        HStack(spacing: 16) {
            Button { viewModel.stepBack() } label: {
                Image(systemName: "backward.fill")
            }
            .disabled(displayedPly == 0)

            Button {
                if viewModel.isBrowsingHistory {
                    viewModel.returnToLivePosition()
                }
            } label: {
                Image(systemName: "forward.end.fill")
            }
            .disabled(!viewModel.isBrowsingHistory)

            Button { viewModel.stepForward() } label: {
                Image(systemName: "forward.fill")
            }
            .disabled(displayedPly >= viewModel.livePly)
        }
        .font(.body)
        .foregroundStyle(.white.opacity(0.85))
        .padding(.horizontal)
    }

    private var actionButtons: some View {
        VStack(spacing: 12) {
            if viewModel.canRetryBot {
                Button("Retry Bot Move") { viewModel.retryBotMove() }
                    .buttonStyle(PrimaryGameButtonStyle())
            }

            HStack(spacing: 12) {
                if viewModel.livePly > 0 {
                    Button("Undo") { viewModel.undo() }
                        .buttonStyle(SecondaryGameButtonStyle())
                        .disabled(viewModel.isBrowsingHistory || viewModel.isThinking)
                }

                Button("New Game") {
                    gameOverDismissed = false
                    viewModel.newGame()
                }
                    .buttonStyle(SecondaryGameButtonStyle())

                Button("Resign") { showResignConfirm = true }
                    .buttonStyle(SecondaryGameButtonStyle())
                    .disabled(viewModel.result != .ongoing)
            }
        }
        .padding(.horizontal)
        .padding(.bottom, 8)
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
