import AuthenticationServices
import SwiftUI

struct SettingsView: View {
    @ObservedObject private var themeStore = BoardThemeStore.shared
    @StateObject private var auth = AuthStore.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                BoardTheme.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if AccountsConfig.isConfigured {
                            accountSection
                        }

                        Text("Board theme")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.7))

                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 12)], spacing: 12) {
                            ForEach(BoardPalette.all) { palette in
                                ThemeSwatch(
                                    palette: palette,
                                    isSelected: themeStore.palette.id == palette.id
                                ) {
                                    themeStore.palette = palette
                                }
                            }
                        }
                    }
                    .padding(20)
                }
            }
            .navigationTitle("Settings")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { await auth.restore() }
    }

    // MARK: - Account section

    @ViewBuilder
    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Account")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.7))

            if auth.profile == nil {
                signInButtons
            } else {
                signedInProfile
            }

            if let error = auth.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    @ViewBuilder
    private var signInButtons: some View {
        VStack(spacing: 10) {
            Button {
                auth.signInWithApple()
            } label: {
                Label("Sign in with Apple", systemImage: "apple.logo")
                    .frame(maxWidth: .infinity)
                    .padding(14)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(BoardTheme.surface)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(BoardTheme.border, lineWidth: 1)
                    )
                    .foregroundStyle(.white)
            }
            .buttonStyle(.plain)

            if AccountsConfig.isGoogleConfigured {
                Button {
                    #if os(iOS)
                    let scene = UIApplication.shared.connectedScenes
                        .compactMap { $0 as? UIWindowScene }
                        .first
                    let rootVC = scene?.keyWindow?.rootViewController
                    auth.signInWithGoogle(presenting: rootVC)
                    #endif
                } label: {
                    Label("Sign in with Google", systemImage: "globe")
                        .frame(maxWidth: .infinity)
                        .padding(14)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(BoardTheme.surface)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(BoardTheme.border, lineWidth: 1)
                        )
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private var signedInProfile: some View {
        if let profile = auth.profile {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    // Avatar: network image or initial-letter fallback
                    Group {
                        if let avatarUrl = profile.avatarUrl, let url = URL(string: avatarUrl) {
                            AsyncImage(url: url) { image in
                                image.resizable().scaledToFill()
                            } placeholder: {
                                avatarFallback(profile.displayName)
                            }
                        } else {
                            avatarFallback(profile.displayName)
                        }
                    }
                    .frame(width: 44, height: 44)
                    .clipShape(Circle())

                    VStack(alignment: .leading, spacing: 2) {
                        DisplayNameField(displayName: profile.displayName) { newName in
                            await auth.updateDisplayName(newName)
                        }
                        Text(profile.email)
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.55))
                    }
                }

                Button("Sign out") {
                    auth.signOut()
                }
                .font(.subheadline)
                .foregroundStyle(.red.opacity(0.85))
                .padding(.top, 4)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(BoardTheme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(BoardTheme.border, lineWidth: 1)
            )
        }
    }

    private func avatarFallback(_ name: String) -> some View {
        let initial = name.first.map(String.init) ?? "?"
        return ZStack {
            Circle().fill(BoardTheme.accent.opacity(0.25))
            Text(initial)
                .font(.headline.bold())
                .foregroundStyle(BoardTheme.accent)
        }
    }
}

// MARK: - DisplayNameField

private struct DisplayNameField: View {
    let displayName: String
    let onCommit: (String) async -> Void

    @State private var editing: String?

    var body: some View {
        TextField("Display name", text: Binding(
            get: { editing ?? displayName },
            set: { editing = $0 }
        ))
        .font(.subheadline.weight(.medium))
        .foregroundStyle(.white)
        .onSubmit {
            let value = (editing ?? displayName).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty, value.count <= 30 else { return }
            let captured = value
            Task { await onCommit(captured) }
            editing = nil
        }
    }
}

// MARK: - ThemeSwatch

private struct ThemeSwatch: View {
    let palette: BoardPalette
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                    GridRow {
                        Rectangle().fill(palette.lightSquare)
                        Rectangle().fill(palette.darkSquare)
                    }
                    GridRow {
                        Rectangle().fill(palette.darkSquare)
                        Rectangle().fill(palette.lightSquare)
                    }
                }
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                Text(palette.name)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.75))
            }
            .padding(10)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(BoardTheme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(isSelected ? BoardTheme.accent : BoardTheme.border,
                            lineWidth: isSelected ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    SettingsView()
}
