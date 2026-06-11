import SwiftUI

struct SettingsView: View {
    @ObservedObject private var themeStore = BoardThemeStore.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                BoardTheme.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
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
    }
}

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
