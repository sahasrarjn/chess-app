import SwiftUI

struct LeaderboardView: View {
    @State private var entries: [LeaderboardEntry] = []
    @State private var me: LeaderboardMe?
    @State private var loadError = false
    @State private var loaded = false

    @StateObject private var auth = AuthStore.shared

    var body: some View {
        ZStack {
            BoardTheme.background.ignoresSafeArea()

            if !loaded {
                ProgressView()
                    .tint(.white)
            } else if loadError {
                Text("Couldn't load the leaderboard")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.55))
                    .multilineTextAlignment(.center)
                    .padding(32)
            } else if entries.isEmpty {
                emptyState
            } else {
                leaderboardContent
            }
        }
        .navigationTitle("Leaderboard")
        .chessAppNavigationChromeHidden()
        .task {
            guard AccountsConfig.isConfigured, let url = AccountsConfig.serverURL else {
                loaded = true
                return
            }
            do {
                let result = try await AccountsAPI(baseURL: url).leaderboard(token: auth.sessionToken)
                entries = result.entries
                me = result.me
            } catch {
                loadError = true
            }
            loaded = true
        }
    }

    // MARK: - Content

    private var leaderboardContent: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if let me, !LeaderboardView.statLines(me.stats).isEmpty {
                    yourStatsSection(me: me)
                }
                topPlayersSection
                if let me, me.rank == nil, me.games > 0 {
                    yourRankingSection(me: me)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 24)
        }
    }

    // MARK: - Your stats section

    private func yourStatsSection(me: LeaderboardMe) -> some View {
        Group {
            sectionHeader("Your stats")
            ForEach(LeaderboardView.statLines(me.stats), id: \.label) { line in
                GameSurfaceCard {
                    HStack {
                        Text(line.label)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.white)
                        Spacer(minLength: 8)
                        Text("\(line.w)W \(line.l)L \(line.d)D · \(LeaderboardView.winRateText(w: line.w, g: line.w + line.l + line.d))")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.75))
                            .monospacedDigit()
                    }
                    .padding(.vertical, 2)
                }
                .padding(.bottom, 8)
            }
        }
    }

    // MARK: - Top players section

    private var topPlayersSection: some View {
        Group {
            sectionHeader("Top players")
            ForEach(entries) { entry in
                let isOwnRow = entry.rank == me?.rank
                GameSurfaceCard {
                    HStack(spacing: 10) {
                        Text("\(entry.rank)")
                            .font(.subheadline.weight(.semibold).monospacedDigit())
                            .foregroundStyle(.white.opacity(0.7))
                            .frame(minWidth: 28, alignment: .trailing)

                        avatarView(urlString: entry.avatarUrl)

                        Text(entry.displayName)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.white)
                            .lineLimit(1)

                        Spacer(minLength: 4)

                        Text("\(entry.wins)W · \(entry.games)G · \(LeaderboardView.winRateText(w: entry.wins, g: entry.games))")
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.75))
                            .monospacedDigit()
                    }
                    .padding(.vertical, 2)
                }
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(isOwnRow ? BoardTheme.accent.opacity(0.6) : Color.clear, lineWidth: 1.5)
                )
                .padding(.bottom, 8)
            }
        }
    }

    // MARK: - Pinned your ranking section

    private func yourRankingSection(me: LeaderboardMe) -> some View {
        Group {
            sectionHeader("Your ranking")
            GameSurfaceCard {
                HStack(spacing: 10) {
                    Text("—")
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.white.opacity(0.7))
                        .frame(minWidth: 28, alignment: .trailing)

                    avatarView(urlString: me.avatarUrl)

                    Text(me.displayName)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.white)
                        .lineLimit(1)

                    Spacer(minLength: 4)

                    Text("\(me.wins)W · \(me.games)G · \(LeaderboardView.winRateText(w: me.wins, g: me.games))")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.75))
                        .monospacedDigit()
                }
                .padding(.vertical, 2)
            }
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(BoardTheme.accent.opacity(0.6), lineWidth: 1.5)
            )
            .padding(.bottom, 8)
        }
    }

    // MARK: - Avatar

    private func avatarView(urlString: String?) -> some View {
        Group {
            if let urlString, let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        Circle().fill(Color.gray.opacity(0.4))
                    }
                }
                .frame(width: 24, height: 24)
                .clipShape(Circle())
            } else {
                Circle()
                    .fill(Color.gray.opacity(0.4))
                    .frame(width: 24, height: 24)
            }
        }
    }

    // MARK: - Section header

    private func sectionHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white.opacity(0.45))
            .padding(.bottom, 6)
            .padding(.top, 8)
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "trophy")
                .font(.system(size: 40))
                .foregroundStyle(.white.opacity(0.3))
            Text("No ranked players yet — win an online game!")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.55))
                .multilineTextAlignment(.center)
        }
        .padding(32)
    }

    // MARK: - Stat-lines helper (testable)

    /// Produces stat rows for "Your stats" in display order: Online first, then
    /// Bot · easy / medium / hard. Zero-game rows are omitted.
    static func statLines(_ stats: [String: Int]) -> [(label: String, w: Int, l: Int, d: Int)] {
        var result: [(label: String, w: Int, l: Int, d: Int)] = []

        let onlineW = stats["online_w"] ?? 0
        let onlineL = stats["online_l"] ?? 0
        let onlineD = stats["online_d"] ?? 0
        if onlineW + onlineL + onlineD > 0 {
            result.append((label: "Online", w: onlineW, l: onlineL, d: onlineD))
        }

        let difficulties: [(key: String, label: String)] = [
            ("easy",   "Bot · easy"),
            ("medium", "Bot · medium"),
            ("hard",   "Bot · hard"),
        ]
        for diff in difficulties {
            let w = stats["bot_\(diff.key)_w"] ?? 0
            let l = stats["bot_\(diff.key)_l"] ?? 0
            let d = stats["bot_\(diff.key)_d"] ?? 0
            if w + l + d > 0 {
                result.append((label: diff.label, w: w, l: l, d: d))
            }
        }

        return result
    }

    // MARK: - Win-rate helper

    /// Returns a rounded win-rate percentage string, or "—" when games == 0.
    static func winRateText(w: Int, g: Int) -> String {
        guard g > 0 else { return "—" }
        return "\(Int(round(Double(w) / Double(g) * 100)))%"
    }
}
