import SwiftUI

struct PastGamesView: View {
    @State private var cloudGames: [CompletedGameRecord] = []
    @State private var nextCursor: String?
    @State private var cloudError = false
    @State private var localGames: [CompletedGameRecord] = []
    @State private var isLoadingMore = false

    @StateObject private var auth = AuthStore.shared

    var body: some View {
        ZStack {
            BoardTheme.background.ignoresSafeArea()

            if localGames.isEmpty && cloudGames.isEmpty {
                emptyState
            } else {
                gameList
            }
        }
        .navigationTitle("Past Games")
        .chessAppNavigationChromeHidden()
        .task {
            localGames = GameHistoryStore.load()
            await loadCloudGames(cursor: nil)
        }
    }

    // MARK: - Game list

    private var gameList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if auth.isSignedIn, AccountsConfig.isConfigured {
                    cloudSection
                }
                localSection
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 24)
        }
    }

    // MARK: - Cloud section

    @ViewBuilder
    private var cloudSection: some View {
        if cloudError {
            Text("Couldn't load cloud games")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.5))
                .padding(.bottom, 8)
        } else if !cloudGames.isEmpty {
            sectionHeader("Your games")
            ForEach(cloudGames) { record in
                gameRow(record)
            }
            if let _ = nextCursor {
                loadMoreButton
            }
        }
    }

    // MARK: - Local section

    private var localSection: some View {
        Group {
            if !localGames.isEmpty {
                sectionHeader("On this device")
                ForEach(localGames) { record in
                    gameRow(record)
                }
            }
        }
    }

    // MARK: - Row

    private func gameRow(_ record: CompletedGameRecord) -> some View {
        NavigationLink {
            GameView(replay: record)
        } label: {
            GameSurfaceCard {
                HStack(spacing: 12) {
                    resultBadge(record)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(record.opponent)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.white)
                        HStack(spacing: 8) {
                            Text(formattedDate(record.endedAt))
                                .font(.caption2)
                                .foregroundStyle(.white.opacity(0.55))
                            Text("\(record.moves.count) moves")
                                .font(.caption2)
                                .foregroundStyle(.white.opacity(0.55))
                        }
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.3))
                }
                .padding(.vertical, 4)
            }
            .padding(.bottom, 8)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Result badge

    private func resultBadge(_ record: CompletedGameRecord) -> some View {
        Text(resultLabel(record))
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(resultBadgeColor(record))
            )
            .frame(minWidth: 30)
    }

    private func resultLabel(_ record: CompletedGameRecord) -> String {
        if let playerColor = record.playerColor {
            // vsBot or online — relative result
            switch record.resultType {
            case "checkmate", "resignation":
                if record.winner == playerColor { return "W" }
                return "L"
            case "stalemate", "draw":
                return "D"
            default:
                return "?"
            }
        } else {
            // localTwoPlayer — absolute score
            switch record.resultType {
            case "checkmate", "resignation":
                return record.winner == "white" ? "1–0" : "0–1"
            case "stalemate", "draw":
                return "½"
            default:
                return "?"
            }
        }
    }

    private func resultBadgeColor(_ record: CompletedGameRecord) -> Color {
        let label = resultLabel(record)
        switch label {
        case "W": return Color.green.opacity(0.75)
        case "L": return Color.red.opacity(0.65)
        case "D": return Color.gray.opacity(0.55)
        default:  return BoardTheme.surface
        }
    }

    // MARK: - Load more

    private var loadMoreButton: some View {
        Button {
            Task { await loadCloudGames(cursor: nextCursor) }
        } label: {
            Text(isLoadingMore ? "Loading…" : "Load more")
                .font(.subheadline)
                .foregroundStyle(BoardTheme.accent)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
        }
        .disabled(isLoadingMore)
        .buttonStyle(.plain)
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
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 40))
                .foregroundStyle(.white.opacity(0.3))
            Text("No finished games yet — play one!")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.55))
                .multilineTextAlignment(.center)
        }
        .padding(32)
    }

    // MARK: - Helpers

    private func loadCloudGames(cursor: String?) async {
        guard auth.isSignedIn,
              AccountsConfig.isConfigured,
              let token = auth.sessionToken,
              let url = AccountsConfig.serverURL else { return }
        isLoadingMore = cursor != nil
        defer { isLoadingMore = false }
        do {
            let page = try await AccountsAPI(baseURL: url).listGames(token: token, cursor: cursor)
            if cursor == nil {
                cloudGames = page.games
            } else {
                cloudGames.append(contentsOf: page.games)
            }
            nextCursor = page.nextCursor
        } catch {
            if cursor == nil { cloudError = true }
        }
    }

    private func formattedDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = formatter.date(from: iso)
        if date == nil {
            formatter.formatOptions = [.withInternetDateTime]
            date = formatter.date(from: iso)
        }
        guard let date else { return iso }
        let display = DateFormatter()
        display.dateStyle = .medium
        display.timeStyle = .none
        return display.string(from: date)
    }
}
