import SwiftUI
#if canImport(GoogleSignIn)
import GoogleSignIn
#endif

@main
struct ChessBorderApp: App {
    @State private var showSplash = true

    var body: some Scene {
        WindowGroup {
            ZStack {
                HomeView()
                    .preferredColorScheme(.dark)
                if showSplash {
                    SplashView()
                        .transition(.opacity)
                }
            }
            .task {
                #if os(macOS)
                let splashMs: UInt64 = 700
                #else
                let splashMs: UInt64 = 850
                #endif
                try? await Task.sleep(for: .milliseconds(splashMs))
                withAnimation(.easeOut(duration: 0.28)) {
                    showSplash = false
                }
            }
            #if canImport(GoogleSignIn)
            .onOpenURL { url in
                GIDSignIn.sharedInstance.handle(url)
            }
            #endif
        }
    }
}
