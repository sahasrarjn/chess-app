import Foundation

enum EngineBundle {
    private static let engineBinaryNames = ["fairy-stockfish", "fairy-stockfish-ios"]

    static var fairyStockfishURL: URL? {
        for name in engineBinaryNames {
            if let url = Bundle.main.url(forResource: name, withExtension: nil, subdirectory: "Engine") {
                return url
            }
            if let url = Bundle.main.url(forResource: name, withExtension: nil) {
                return url
            }
        }
        return nil
    }

    static var variantsURL: URL? {
        Bundle.main.url(forResource: "variants", withExtension: "ini", subdirectory: "Engine")
            ?? Bundle.main.url(forResource: "variants", withExtension: "ini")
    }

    static var isFairyStockfishAvailable: Bool {
        #if os(iOS) && !targetEnvironment(simulator)
        return false
        #else
        guard let url = fairyStockfishURL else { return false }
        return FileManager.default.isExecutableFile(atPath: url.path)
        #endif
    }
}
