import SwiftUI

struct MoveListView: View {
    let moves: [RecordedMove]
    let selectedPly: Int
    let livePly: Int
    let onSelect: (Int) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(groupedMoves, id: \.moveNumber) { group in
                        HStack(spacing: 6) {
                            Text("\(group.moveNumber).")
                                .foregroundStyle(BoardTheme.muted)
                                .font(.caption.monospaced())

                            moveButton(group.white, ply: group.whitePly)
                            if let black = group.black, let blackPly = group.blackPly {
                                moveButton(black, ply: blackPly)
                            }
                        }
                    }

                    if selectedPly < livePly {
                        Button("Live") {
                            onSelect(livePly)
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BoardTheme.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(BoardTheme.accent.opacity(0.15))
                        .clipShape(Capsule())
                    }
                }
                .padding(.horizontal, 4)
            }
            .onChange(of: livePly) { _, newValue in
                withAnimation {
                    proxy.scrollTo(newValue, anchor: .trailing)
                }
            }
        }
        .frame(minHeight: 40)
    }

    private func moveButton(_ san: String, ply: Int) -> some View {
        Button {
            onSelect(ply)
        } label: {
            Text(san)
                .font(.caption.weight(.semibold).monospaced())
                .foregroundStyle(ply == selectedPly ? .black.opacity(0.9) : .white.opacity(0.9))
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(ply == selectedPly ? BoardTheme.accent : BoardTheme.background.opacity(0.6))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(ply == selectedPly ? Color.clear : BoardTheme.border, lineWidth: 1)
                )
        }
        .id(ply)
    }

    private var groupedMoves: [MoveGroup] {
        var groups: [MoveGroup] = []
        var index = 0
        while index < moves.count {
            let white = moves[index]
            index += 1
            if index < moves.count, moves[index].color == .black {
                let black = moves[index]
                groups.append(MoveGroup(
                    moveNumber: white.ply / 2 + 1,
                    white: white.san,
                    whitePly: white.ply + 1,
                    black: black.san,
                    blackPly: black.ply + 1
                ))
                index += 1
            } else {
                groups.append(MoveGroup(
                    moveNumber: white.ply / 2 + 1,
                    white: white.san,
                    whitePly: white.ply + 1,
                    black: nil,
                    blackPly: nil
                ))
            }
        }
        return groups
    }

    private struct MoveGroup {
        let moveNumber: Int
        let white: String
        let whitePly: Int
        let black: String?
        let blackPly: Int?
    }
}

struct CapturedPiecesBar: View {
    let capturedByWhite: [Piece]
    let capturedByBlack: [Piece]

    private let pieceSize: CGFloat = 24

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            capturedStack(capturedByBlack, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            materialDelta
                .frame(minWidth: 28)
            capturedStack(capturedByWhite, alignment: .trailing)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 8)
        .frame(minHeight: pieceSize + 4)
    }

    @ViewBuilder
    private var materialDelta: some View {
        let delta = materialScore(capturedByWhite) - materialScore(capturedByBlack)
        if delta != 0 {
            Text(delta > 0 ? "+\(delta)" : "\(delta)")
                .font(.caption2.weight(.bold).monospaced())
                .foregroundStyle(BoardTheme.accent)
                .padding(.top, 2)
        }
    }

    private func capturedStack(_ pieces: [Piece], alignment: HorizontalAlignment) -> some View {
        CapturedPiecesFlow(spacing: 2, rowSpacing: 2) {
            ForEach(Array(sortedCaptures(pieces).enumerated()), id: \.offset) { _, piece in
                PieceView(piece: piece)
                    .frame(width: pieceSize, height: pieceSize)
            }
        }
        .frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .trailing)
    }

    private func sortedCaptures(_ pieces: [Piece]) -> [Piece] {
        pieces.sorted { $0.kind.value > $1.kind.value }
    }

    private func materialScore(_ pieces: [Piece]) -> Int {
        pieces.reduce(0) { $0 + $1.kind.value / 100 }
    }
}

private struct CapturedPiecesFlow: Layout {
    var spacing: CGFloat = 2
    var rowSpacing: CGFloat = 2

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        guard maxWidth.isFinite, maxWidth > 0 else {
            return CGSize(width: proposal.width ?? 0, height: 0)
        }

        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var contentWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + rowSpacing
                rowHeight = 0
            }
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            contentWidth = max(contentWidth, min(x - spacing, maxWidth))
        }

        return CGSize(width: contentWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += rowHeight + rowSpacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: size.width, height: size.height))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }
    }
}
