import SwiftUI

/// A selectable board color palette. Hex values must stay identical to
/// web/src/theme/boardThemes.ts so both platforms match.
struct BoardPalette: Equatable, Identifiable {
    let id: String
    let name: String
    let lightSquare: Color
    let darkSquare: Color
    var legalMove: Color? = nil

    static let all: [BoardPalette] = [
        BoardPalette(id: "classic", name: "Classic Green",
                     lightSquare: Color(srgbHex: 0xEEEED1), darkSquare: Color(srgbHex: 0x769656)),
        BoardPalette(id: "walnut", name: "Walnut",
                     lightSquare: Color(srgbHex: 0xF0D9B5), darkSquare: Color(srgbHex: 0xB58863)),
        BoardPalette(id: "ocean", name: "Ocean",
                     lightSquare: Color(srgbHex: 0xE3ECF2), darkSquare: Color(srgbHex: 0x6E98B5)),
        BoardPalette(id: "slate", name: "Slate",
                     lightSquare: Color(srgbHex: 0xE4E6E9), darkSquare: Color(srgbHex: 0x7D848D)),
        BoardPalette(id: "tournament", name: "Tournament",
                     lightSquare: Color(srgbHex: 0xFFCE9E), darkSquare: Color(srgbHex: 0xD18B47)),
        BoardPalette(id: "high-contrast", name: "High Contrast",
                     lightSquare: Color(srgbHex: 0xFFFFFF), darkSquare: Color(srgbHex: 0x444444),
                     legalMove: Color(srgbHex: 0x8C8C8C).opacity(0.55)),
        BoardPalette(id: "rosewood", name: "Rosewood",
                     lightSquare: Color(srgbHex: 0xF1DCD6), darkSquare: Color(srgbHex: 0xA8716E)),
        BoardPalette(id: "blossom", name: "Blossom",
                     lightSquare: Color(srgbHex: 0xFBEEF2), darkSquare: Color(srgbHex: 0xD98EA4)),
    ]

    static func palette(forId id: String?) -> BoardPalette {
        all.first { $0.id == id } ?? all[0]
    }
}

extension Color {
    init(srgbHex hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
