import SwiftUI

/// Small 10×10 checker with inner frame — brand mark for splash and home (not a photo asset).
struct LaunchBrandMark: View {
    var size: CGFloat = 96

    private let gridSize = 10
    private let playableSpan = 8

    var body: some View {
        let square = size / CGFloat(gridSize)

        ZStack {
            VStack(spacing: 0) {
                ForEach(0..<gridSize, id: \.self) { row in
                    HStack(spacing: 0) {
                        ForEach(0..<gridSize, id: \.self) { col in
                            Rectangle()
                                .fill((row + col) % 2 == 0 ? BoardTheme.lightSquare : BoardTheme.darkSquare)
                                .frame(width: square, height: square)
                        }
                    }
                }
            }

            RoundedRectangle(cornerRadius: 2)
                .stroke(BoardTheme.accent.opacity(0.9), lineWidth: max(2, square * 0.12))
                .frame(width: square * CGFloat(playableSpan), height: square * CGFloat(playableSpan))
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: size * 0.14, style: .continuous)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.45), radius: size * 0.14, y: size * 0.06)
    }
}

struct SplashView: View {
    @State private var appeared = false

    var body: some View {
        ZStack {
            BoardTheme.background.ignoresSafeArea()

            VStack(spacing: 22) {
                LaunchBrandMark(size: 112)
                    .scaleEffect(appeared ? 1 : 0.9)
                    .opacity(appeared ? 1 : 0)

                VStack(spacing: 8) {
                    Text("Border Chess")
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)

                    Text("Room to maneuver on every side")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.55))
                        .multilineTextAlignment(.center)
                }
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 8)

                ProgressView()
                    .controlSize(.regular)
                    .tint(BoardTheme.accent)
                    .padding(.top, 4)
                    .opacity(appeared ? 1 : 0)
            }
            .padding(.horizontal, 36)
        }
        .onAppear {
            withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
                appeared = true
            }
        }
    }
}

#Preview {
    SplashView()
}
