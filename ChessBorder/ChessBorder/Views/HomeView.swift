import SwiftUI

struct HomeView: View {
    @State private var selectedDifficulty: BotDifficulty = .medium
    @State private var restoredGame: SavedGameSnapshot?
    @State private var showHomeDespiteSave = false

    var body: some View {
        Group {
            if let saved = restoredGame, !showHomeDespiteSave {
                GameView(saved: saved, onReturnHome: { showHomeDespiteSave = true })
            } else {
                homeContent
            }
        }
        .onAppear {
            if restoredGame == nil, !showHomeDespiteSave {
                restoredGame = SavedGameStore.load()
            }
        }
    }

    private var homeContent: some View {
        NavigationStack {
            ZStack {
                BoardTheme.background.ignoresSafeArea()

                VStack(spacing: 32) {
                    VStack(spacing: 12) {
                        LaunchBrandMark(size: 88)

                        Text("Border Chess")
                            .font(.largeTitle.bold())
                            .foregroundStyle(.white)

                        Text("Standard chess on a 10×10 board\nwith room to maneuver on every side")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.7))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }
                    .padding(.top, 40)

                    VStack(spacing: 14) {
                        ForEach(GameMode.allCases) { mode in
                            if mode == .vsBot {
                                VStack(spacing: 10) {
                                    NavigationLink {
                                        GameView(mode: .vsBot, difficulty: selectedDifficulty)
                                    } label: {
                                        ModeButtonLabel(title: mode.rawValue, subtitle: botModeSubtitle)
                                    }

                                    Picker("Difficulty", selection: $selectedDifficulty) {
                                        ForEach(BotDifficulty.allCases) { level in
                                            Text(level.rawValue).tag(level)
                                        }
                                    }
                                    .pickerStyle(.segmented)
                                    .padding(.horizontal, 4)
                                }
                            } else {
                                NavigationLink {
                                    GameView(mode: mode)
                                } label: {
                                    ModeButtonLabel(title: mode.rawValue, subtitle: "Two players, one iPhone")
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 24)

                    Spacer()

                    VStack(spacing: 4) {
                        Text("Bot: \(BotProvider.engineName)")
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.45))
                        Text("Pieces: Lichess Maestro")
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.45))
                    }
                    .padding(.bottom, 24)
                }
            }
            .chessAppNavigationChromeHidden()
        }
    }

    private var botModeSubtitle: String {
        "Single player vs Fairy-Stockfish"
    }
}

private struct ModeButtonLabel: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.headline)
            Text(subtitle)
                .font(.caption)
                .opacity(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .foregroundStyle(.white)
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(BoardTheme.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(BoardTheme.border, lineWidth: 1)
                )
        )
    }
}

#Preview {
    HomeView()
}
