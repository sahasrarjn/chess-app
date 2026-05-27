import SwiftUI

extension View {
    @ViewBuilder
    func chessAppNavigationChromeHidden() -> some View {
        #if os(iOS)
        navigationBarHidden(true)
        #else
        toolbar(.hidden, for: .windowToolbar)
        #endif
    }
}
