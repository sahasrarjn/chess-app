import SwiftUI

struct HomeView: View {
    @State private var selectedDifficulty: BotDifficulty = .medium
    #if os(iOS)
    @State private var engineServerURL = BotServerConfig.urlString
    @State private var engineAPIKey = BotServerConfig.apiKeyString
    #endif

    var body: some View {
        NavigationStack {
            ZStack {
                BoardTheme.background.ignoresSafeArea()

                VStack(spacing: 32) {
                    VStack(spacing: 8) {
                        Image(systemName: "square.grid.3x3.bottomleft.filled")
                            .font(.system(size: 48))
                            .foregroundStyle(BoardTheme.accent)

                        Text("Chess Border")
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

                                    #if os(iOS)
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("Engine server")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(.white.opacity(0.7))
                                        TextField("https://your-engine.example.com", text: $engineServerURL)
                                            .textInputAutocapitalization(.never)
                                            .autocorrectionDisabled()
                                            .keyboardType(.URL)
                                            .font(.caption)
                                            .padding(10)
                                            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                                            .onChange(of: engineServerURL) { _, newValue in
                                                BotServerConfig.urlString = newValue
                                            }
                                        TextField("API key (optional)", text: $engineAPIKey)
                                            .textInputAutocapitalization(.never)
                                            .autocorrectionDisabled()
                                            .font(.caption)
                                            .padding(10)
                                            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                                            .onChange(of: engineAPIKey) { _, newValue in
                                                BotServerConfig.apiKeyString = newValue
                                            }
                                        if BotProvider.needsServerConfiguration {
                                            Text("Required on iPhone — deploy with server/aws/deploy.sh")
                                                .font(.caption2)
                                                .foregroundStyle(.orange.opacity(0.9))
                                        }
                                    }
                                    .padding(.horizontal, 4)
                                    #endif
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
                        Text("Pieces: Lichess Cburnett · GPL v3 app")
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
        #if os(iOS) && !targetEnvironment(simulator)
        return "Fairy-Stockfish via your server"
        #else
        return "Single player vs Fairy-Stockfish"
        #endif
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
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.white.opacity(0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(BoardTheme.accent.opacity(0.35), lineWidth: 1)
                )
        )
    }
}

#Preview {
    HomeView()
}
