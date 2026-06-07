import SwiftUI

struct HomeView: View {
    @State private var selectedDifficulty: BotDifficulty = .medium
    @State private var restoredGame: SavedGameSnapshot?
    @State private var showHomeDespiteSave = false
    @StateObject private var updateChecker = AppUpdateChecker()
    @Environment(\.openURL) private var openURL
    @State private var joinCode = ""
    @State private var onlineRoom: OnlineRoom?

    private struct OnlineRoom: Identifiable, Hashable {
        let id: String
    }

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
                    if updateChecker.updateAvailable {
                        updateBanner
                            .padding(.top, 12)
                    }

                    VStack(spacing: 12) {
                        AppLogo(size: 88)

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

                        if MultiplayerConfig.isConfigured {
                            onlineSection
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
            .navigationDestination(item: $onlineRoom) { room in
                OnlineGameView(roomId: room.id)
            }
        }
        .task {
            await updateChecker.checkForUpdate()
        }
    }

    private var onlineSection: some View {
        VStack(spacing: 10) {
            Button {
                onlineRoom = OnlineRoom(id: OnlineIdentity.newRoomCode())
            } label: {
                ModeButtonLabel(title: "Play Online", subtitle: "Invite a friend with a link")
            }
            .buttonStyle(.plain)

            HStack(spacing: 8) {
                TextField("Room code", text: $joinCode)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                Button("Join") {
                    if let code = OnlineIdentity.roomId(fromInput: joinCode) {
                        joinCode = ""
                        onlineRoom = OnlineRoom(id: code)
                    }
                }
                .buttonStyle(GameChromeButtonStyle(variant: .secondary))
            }
        }
    }

    private var updateBanner: some View {
        HStack(spacing: 12) {
            Image(systemName: "arrow.down.circle.fill")
                .font(.title3)
                .foregroundStyle(BoardTheme.accent)

            VStack(alignment: .leading, spacing: 2) {
                Text("Update available")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                Text(updateChecker.latestVersion.map { "Tap to get version \($0)" }
                        ?? "Tap to update on the App Store")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.7))
            }

            Spacer(minLength: 8)

            Button {
                updateChecker.dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.white.opacity(0.6))
                    .padding(8)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(BoardTheme.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(BoardTheme.accent.opacity(0.4), lineWidth: 1)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            openURL(updateChecker.storeURL)
        }
        .padding(.horizontal, 24)
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

// MARK: - App update check

/// Checks the App Store for a newer version and surfaces a dismissible banner.
/// iOS only; best-effort (any failure is silently ignored and never blocks play).
@MainActor
final class AppUpdateChecker: ObservableObject {
    @Published private(set) var updateAvailable = false
    @Published private(set) var latestVersion: String?

    let storeURL = URL(string: "https://apps.apple.com/app/border-chess/id6774101655")!

    private let dismissedVersionKey = "bc_update_dismissed_version"
    private let lastCheckKey = "bc_update_last_check"
    /// Throttle network lookups to at most once per day.
    private let minCheckInterval: TimeInterval = 60 * 60 * 24

    func checkForUpdate() async {
        #if os(iOS)
        let defaults = UserDefaults.standard
        let now = Date().timeIntervalSince1970
        let last = defaults.double(forKey: lastCheckKey)
        if last > 0, now - last < minCheckInterval { return }

        guard let bundleID = Bundle.main.bundleIdentifier,
              let current = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
              let lookupURL = URL(string: "https://itunes.apple.com/lookup?bundleId=\(bundleID)") else {
            return
        }

        do {
            let (data, _) = try await URLSession.shared.data(from: lookupURL)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let results = json["results"] as? [[String: Any]],
                  let storeVersion = results.first?["version"] as? String else {
                return
            }
            defaults.set(now, forKey: lastCheckKey)

            guard compareVersions(storeVersion, current) == .orderedDescending else { return }
            if defaults.string(forKey: dismissedVersionKey) == storeVersion { return }

            latestVersion = storeVersion
            updateAvailable = true
        } catch {
            // Offline / parse failure: leave the banner hidden.
        }
        #endif
    }

    func dismiss() {
        if let latestVersion {
            UserDefaults.standard.set(latestVersion, forKey: dismissedVersionKey)
        }
        updateAvailable = false
    }
}

/// Numeric, component-wise version comparison (e.g. "1.0.10" > "1.0.2").
func compareVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
    let lhsParts = lhs.split(separator: ".").map { Int($0) ?? 0 }
    let rhsParts = rhs.split(separator: ".").map { Int($0) ?? 0 }
    let count = max(lhsParts.count, rhsParts.count)
    for index in 0..<count {
        let l = index < lhsParts.count ? lhsParts[index] : 0
        let r = index < rhsParts.count ? rhsParts[index] : 0
        if l != r { return l < r ? .orderedAscending : .orderedDescending }
    }
    return .orderedSame
}

#Preview {
    HomeView()
}
