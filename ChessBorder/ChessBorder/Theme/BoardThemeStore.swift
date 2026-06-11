import SwiftUI

/// Holds the selected board palette; persists the choice to UserDefaults.
final class BoardThemeStore: ObservableObject {
    static let shared = BoardThemeStore()
    static let defaultsKey = "chessborder.boardTheme"

    @Published var palette: BoardPalette {
        didSet { defaults.set(palette.id, forKey: Self.defaultsKey) }
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.palette = BoardPalette.palette(forId: defaults.string(forKey: Self.defaultsKey))
    }
}
