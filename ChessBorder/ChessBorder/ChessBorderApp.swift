import SwiftUI

@main
struct ChessBorderApp: App {
    #if os(macOS)
    @State private var showSplash = true
    #endif

    var body: some Scene {
        WindowGroup {
            #if os(macOS)
            ZStack {
                HomeView()
                    .preferredColorScheme(.dark)
                if showSplash {
                    SplashView()
                        .transition(.opacity)
                }
            }
            .task {
                try? await Task.sleep(for: .milliseconds(700))
                withAnimation(.easeOut(duration: 0.25)) {
                    showSplash = false
                }
            }
            #else
            HomeView()
                .preferredColorScheme(.dark)
            #endif
        }
    }
}
