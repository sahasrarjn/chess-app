import SwiftUI

struct AppLogo: View {
    var size: CGFloat = 96

    var body: some View {
        Image("LaunchLogo")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.14, style: .continuous))
            .shadow(color: .black.opacity(0.45), radius: size * 0.14, y: size * 0.06)
    }
}

struct SplashView: View {
    @State private var appeared = false

    var body: some View {
        ZStack {
            BoardTheme.background.ignoresSafeArea()

            VStack(spacing: 22) {
                AppLogo(size: 112)
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
