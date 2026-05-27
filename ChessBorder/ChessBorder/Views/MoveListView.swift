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
                                .foregroundStyle(.white.opacity(0.45))
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
        .frame(height: 34)
    }

    private func moveButton(_ san: String, ply: Int) -> some View {
        Button {
            onSelect(ply)
        } label: {
            Text(san)
                .font(.caption.weight(.semibold).monospaced())
                .foregroundStyle(ply == selectedPly ? .black : .white)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(ply == selectedPly ? BoardTheme.accent : Color.white.opacity(0.1))
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

    var body: some View {
        HStack {
            capturedStack(capturedByBlack, alignment: .leading)
            Spacer()
            materialDelta
            Spacer()
            capturedStack(capturedByWhite, alignment: .trailing)
        }
        .padding(.horizontal, 8)
        .frame(height: 22)
    }

    @ViewBuilder
    private var materialDelta: some View {
        let delta = materialScore(capturedByWhite) - materialScore(capturedByBlack)
        if delta != 0 {
            Text(delta > 0 ? "+\(delta)" : "\(delta)")
                .font(.caption2.weight(.bold).monospaced())
                .foregroundStyle(BoardTheme.accent)
        }
    }

    private func capturedStack(_ pieces: [Piece], alignment: HorizontalAlignment) -> some View {
        HStack(spacing: 2) {
            ForEach(Array(sortedCaptures(pieces).enumerated()), id: \.offset) { _, piece in
                PieceView(piece: piece)
                    .frame(width: 16, height: 16)
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
