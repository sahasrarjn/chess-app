import XCTest
import SwiftUI
@testable import Border_Chess

@MainActor
final class BoardThemeTests: XCTestCase {
    func testRegistryHasEightUniquePalettes() {
        XCTAssertEqual(BoardPalette.all.count, 8)
        XCTAssertEqual(Set(BoardPalette.all.map(\.id)).count, 8)
    }

    func testClassicIsDefaultAndMatchesLegacyBoardColors() {
        let classic = BoardPalette.palette(forId: nil)
        XCTAssertEqual(classic.id, "classic")
        XCTAssertEqual(classic.lightSquare, Color(srgbHex: 0xEEEED1))
        XCTAssertEqual(classic.darkSquare, Color(srgbHex: 0x769656))
    }

    func testIncludesPinkPalettes() {
        let ids = BoardPalette.all.map(\.id)
        XCTAssertTrue(ids.contains("rosewood"))
        XCTAssertTrue(ids.contains("blossom"))
    }

    func testUnknownIdFallsBackToClassic() {
        XCTAssertEqual(BoardPalette.palette(forId: "junk").id, "classic")
    }

    func testStorePersistsSelectionAcrossInstances() {
        let suite = "BoardThemeTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        let store = BoardThemeStore(defaults: defaults)
        XCTAssertEqual(store.palette.id, "classic")
        store.palette = BoardPalette.palette(forId: "rosewood")

        let reloaded = BoardThemeStore(defaults: defaults)
        XCTAssertEqual(reloaded.palette.id, "rosewood")
    }

    func testOnlyHighContrastOverridesLegalMoveTint() {
        for palette in BoardPalette.all {
            if palette.id == "high-contrast" {
                XCTAssertNotNil(palette.legalMove)
            } else {
                XCTAssertNil(palette.legalMove, palette.id)
            }
        }
    }
}
