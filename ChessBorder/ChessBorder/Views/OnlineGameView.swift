import SwiftUI

struct OnlineGameView: View {
    @StateObject private var viewModel: OnlineGameViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var showSettings = false

    init(roomId: String) {
        _viewModel = StateObject(wrappedValue: OnlineGameViewModel(roomId: roomId))
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

                    if let s = viewModel.state, s.status == "waiting", viewModel.role != .spectator {
                        shareCard
                            .padding(.horizontal, 12)
                            .padding(.top, 6)
                    }

                    GameStatusPill(text: statusText)
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
            }
        }
        .chessAppNavigationChromeHidden()
        .onAppear { viewModel.start() }
        .onDisappear { viewModel.dispose() }
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .presentationDetents([.medium, .large])
        }
    }

    // MARK: - Header

    private var header: some View {
        GameNavBar(backTitle: "Leave", onBack: { dismiss() }) {
            GameNavTitle(
                title: viewModel.role == .spectator ? "Spectating" : "Online",
                subtitle: playersSubtitle
            )
        } trailing: {
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

    private var playersSubtitle: String? {
        guard let s = viewModel.state else { return nil }
        let white = s.players.white?.name ?? "—"
        let black = s.players.black?.name ?? "waiting…"
        return "\(white) vs \(black)"
    }

    private var shareCard: some View {
        GameSurfaceCard {
            VStack(spacing: 10) {
                Text("Invite a friend")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                Text("Room code: \(viewModel.roomId)")
                    .font(.callout.monospaced())
                    .foregroundStyle(BoardTheme.accent)
                Text("Waiting for opponent…")
                    .font(.caption)
                    .foregroundStyle(BoardTheme.muted)
                if let url = viewModel.shareURL {
                    ShareLink(item: url) {
                        Label("Share link", systemImage: "square.and.arrow.up")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.black.opacity(0.88))
                            .padding(.horizontal, 18)
                            .frame(height: 44)
                            .frame(maxWidth: .infinity)
                            .background(BoardTheme.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Bottom

    private var bottomPanel: some View {
        VStack(spacing: 10) {
            if viewModel.livePly > 0 {
                GameSurfaceCard {
                    MoveListView(
                        moves: viewModel.recordedMoves,
                        selectedPly: viewModel.displayedPly,
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
            if viewModel.livePly > 0 {
                GameToolStrip {
                    GameToolStripButton(
                        content: .icon("chevron.left"),
                        disabled: viewModel.displayedPly == 0,
                        action: { viewModel.stepBack() }
                    )
                    GameToolStripDivider()
                    GameToolStripButton(
                        content: .icon("chevron.right"),
                        disabled: viewModel.displayedPly >= viewModel.livePly,
                        action: { viewModel.stepForward() }
                    )
                    GameToolStripDivider()
                    GameToolStripButton(
                        content: .text("Live"),
                        disabled: !viewModel.isBrowsingHistory,
                        action: { viewModel.returnToLive() }
                    )
                }
                .frame(maxWidth: .infinity)
            } else {
                Spacer()
            }

            rematchControl
        }
    }

    @ViewBuilder
    private var rematchControl: some View {
        if viewModel.status == "finished", viewModel.role != .spectator {
            let offered = viewModel.state?.rematchOfferedBy
            let mine = colorString(viewModel.pieceColor)
            if let offered, offered != mine {
                GamePrimaryAction(title: "Accept rematch") { viewModel.requestRematch() }
            } else if offered != nil {
                Text("Rematch requested…")
                    .font(.caption)
                    .foregroundStyle(BoardTheme.muted)
            } else {
                GamePrimaryAction(title: "Rematch") { viewModel.requestRematch() }
            }
        }
    }

    private func colorString(_ color: PieceColor?) -> String? {
        switch color {
        case .white: return "white"
        case .black: return "black"
        default: return nil
        }
    }

    // MARK: - Status

    private var statusText: String {
        switch viewModel.connection {
        case .reconnecting: return "Reconnecting…"
        case .closed: return "Disconnected."
        default: break
        }
        guard let s = viewModel.state else { return "Connecting…" }
        if viewModel.isBrowsingHistory {
            return "Reviewing move \(viewModel.displayedPly) of \(viewModel.livePly)"
        }
        switch s.status {
        case "waiting":
            return viewModel.role == .spectator ? "Waiting for players…" : "Waiting for opponent…"
        case "finished":
            return resultText(s.result)
        default:
            let oppConnected = (s.pieceColor == .white ? s.players.black?.connected : s.players.white?.connected) ?? true
            if !oppConnected { return "Opponent disconnected — waiting to reconnect…" }
            if viewModel.role == .spectator {
                return "\(s.moves.count % 2 == 0 ? "White" : "Black") to move"
            }
            return viewModel.yourTurn ? "Your move" : "Opponent's move"
        }
    }

    private func resultText(_ result: OnlineResult) -> String {
        let mine = colorString(viewModel.pieceColor)
        switch result.type {
        case "checkmate":
            if let mine { return result.winner == mine ? "Checkmate — you win!" : "Checkmate — you lose." }
            return result.winner == "white" ? "Checkmate. White wins" : "Checkmate. Black wins"
        case "resignation":
            if let mine { return result.winner == mine ? "Opponent resigned — you win!" : "You resigned." }
            return result.winner == "white" ? "Black resigned. White wins" : "White resigned. Black wins"
        case "stalemate":
            return "Stalemate. Draw"
        case "draw":
            return "Draw" + (result.reason.map { ": \($0)" } ?? "")
        default:
            return ""
        }
    }
}
