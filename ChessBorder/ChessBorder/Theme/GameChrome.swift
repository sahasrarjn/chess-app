import SwiftUI

extension BoardTheme {
    static let surface = Color(red: 0.165, green: 0.165, blue: 0.196)
    static let surfaceElevated = Color(red: 0.2, green: 0.2, blue: 0.24)
    static let muted = Color(red: 0.604, green: 0.604, blue: 0.659)
    static let border = Color.white.opacity(0.1)
    static let dangerText = Color(red: 0.96, green: 0.55, blue: 0.55)
}

// MARK: - Top navigation bar

struct GameNavBar<Center: View, Trailing: View>: View {
    let backTitle: String
    let onBack: () -> Void
    @ViewBuilder var center: () -> Center
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onBack) {
                HStack(spacing: 3) {
                    Image(systemName: "chevron.left")
                        .font(.body.weight(.semibold))
                    Text(backTitle)
                        .font(.body.weight(.medium))
                }
                .foregroundStyle(.white)
                .padding(.vertical, 8)
                .padding(.trailing, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            center()
                .frame(maxWidth: .infinity)

            trailing()
        }
        .padding(.horizontal, 4)
        .frame(minHeight: 44)
    }
}

struct GameNavTitle: View {
    let title: String
    var subtitle: String?

    var body: some View {
        VStack(spacing: 2) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            if let subtitle {
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(BoardTheme.muted)
            }
        }
        .multilineTextAlignment(.center)
    }
}

struct GameNavTextAction: View {
    let title: String
    var active = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(
                    disabled
                        ? BoardTheme.muted.opacity(0.35)
                        : (active ? BoardTheme.accent : BoardTheme.muted)
                )
                .padding(.horizontal, 4)
                .padding(.vertical, 8)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}

struct GameNavIconAction: View {
    let systemName: String
    var active = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(
                    disabled
                        ? BoardTheme.muted.opacity(0.35)
                        : (active ? BoardTheme.accent : BoardTheme.muted)
                )
                .padding(.horizontal, 4)
                .padding(.vertical, 8)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}

// MARK: - Bottom toolbars

/// Connected control strip (navigation / history).
struct GameToolStrip<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        HStack(spacing: 0) {
            content()
        }
        .frame(height: 46)
        .background(BoardTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(BoardTheme.border, lineWidth: 1)
        )
    }
}

struct GameToolStripDivider: View {
    var body: some View {
        Rectangle()
            .fill(BoardTheme.border)
            .frame(width: 1)
            .padding(.vertical, 10)
    }
}

struct GameToolStripButton: View {
    enum Content {
        case icon(String)
        case text(String)
    }

    let content: Content
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                switch content {
                case .icon(let name):
                    Image(systemName: name)
                        .font(.body.weight(.medium))
                case .text(let title):
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                }
            }
            .foregroundStyle(disabled ? BoardTheme.muted.opacity(0.35) : .white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(GameToolStripButtonStyle())
        .disabled(disabled)
    }
}

private struct GameToolStripButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                configuration.isPressed
                    ? Color.white.opacity(0.08)
                    : Color.clear
            )
    }
}

struct GamePrimaryAction: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.black.opacity(0.88))
                .padding(.horizontal, 18)
                .frame(height: 46)
                .background(BoardTheme.accent)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(GamePressableStyle())
    }
}

struct GameSecondaryAction: View {
    let title: String
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(disabled ? BoardTheme.muted.opacity(0.35) : BoardTheme.dangerText)
                .padding(.horizontal, 14)
                .frame(height: 46)
                .background(BoardTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(BoardTheme.border, lineWidth: 1)
                )
        }
        .buttonStyle(GamePressableStyle())
        .disabled(disabled)
    }
}

private struct GamePressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.82 : 1)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

// MARK: - Shared

struct GameSurfaceCard<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .background(BoardTheme.surface.opacity(0.65))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(BoardTheme.border, lineWidth: 1)
            )
    }
}

struct GameStatusPill: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.footnote.weight(.medium))
            .foregroundStyle(BoardTheme.muted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
    }
}

/// Primary / secondary buttons for overlays (promotion, game over).
struct GameChromeButtonStyle: ButtonStyle {
    enum Variant { case primary, secondary, ghost }

    var variant: Variant = .secondary

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(variant == .primary ? Color.black.opacity(0.88) : .white)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(maxWidth: variant == .primary ? .infinity : nil)
            .background(background(configuration.isPressed))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .opacity(configuration.isPressed ? 0.88 : 1)
    }

    private func background(_ pressed: Bool) -> Color {
        switch variant {
        case .primary: BoardTheme.accent.opacity(pressed ? 0.85 : 1)
        case .secondary: BoardTheme.surface
        case .ghost: Color.white.opacity(pressed ? 0.1 : 0.06)
        }
    }
}
