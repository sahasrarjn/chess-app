import SwiftUI

struct PieceView: View {
    let piece: Piece
    var elevated = false

    var body: some View {
        Image(piece.assetName)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .padding(elevated ? 1 : 2)
            .scaleEffect(elevated ? 1.06 : 1.0)
            .shadow(color: elevated ? .black.opacity(0.35) : .clear, radius: elevated ? 5 : 0, y: elevated ? 2 : 0)
            .animation(.spring(response: 0.28, dampingFraction: 0.78), value: elevated)
    }
}

struct SquareView: View {
    let square: Square
    @ObservedObject var viewModel: GameViewModel
    let squareSize: CGFloat

    private var isPlayable: Bool { square.isPlayable }

    var body: some View {
        let bg = viewModel.squareBackgroundColor(square)
        let isCaptureHint = viewModel.isCaptureTarget(square)
        let isSelected = viewModel.isSelected(square)
        let hasPiece = viewModel.piece(at: square) != nil
        let showInteraction = isPlayable || hasPiece || viewModel.isLegalTarget(square)

        ZStack {
            Rectangle()
                .fill(bg)

            if isPlayable {
                if viewModel.isLastMoveSquare(square) {
                    Rectangle().fill(BoardTheme.lastMove)
                }
                if isSelected {
                    Rectangle().fill(BoardTheme.selected)
                }
                if viewModel.isKingInCheck(square) {
                    Rectangle().fill(BoardTheme.check)
                }

                if isSelected {
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(BoardTheme.selectedRing, lineWidth: 2.5)
                        .padding(1)
                }
            } else if isSelected {
                RoundedRectangle(cornerRadius: 2)
                    .stroke(BoardTheme.selectedRing, lineWidth: 2.5)
                    .padding(1)
            }

            if viewModel.isLegalTarget(square) {
                if isCaptureHint {
                    Circle()
                        .strokeBorder(BoardTheme.legalCapture, lineWidth: max(3, squareSize * 0.07))
                        .frame(width: squareSize * 0.82, height: squareSize * 0.82)
                } else {
                    Circle()
                        .fill(BoardTheme.legalMove)
                        .frame(width: squareSize * 0.28, height: squareSize * 0.28)
                }
            }

            if viewModel.isLastMoveSquare(square), !isPlayable {
                Rectangle().fill(BoardTheme.lastMove)
            }

            if let piece = viewModel.piece(at: square) {
                PieceView(piece: piece, elevated: isSelected)
                    .zIndex(isSelected ? 1 : 0)
            }

            coordinateOverlay
        }
        .frame(width: squareSize, height: squareSize)
        .clipped()
        .contentShape(Rectangle())
        .onTapGesture {
            if showInteraction {
                viewModel.handleSquareTap(square)
            }
        }
    }

    @ViewBuilder
    private var coordinateOverlay: some View {
        let labelColor = coordinateLabelColor
        let fontSize = max(8, squareSize * 0.18)

        ZStack {
            if let rank = rankLabelForOverlay {
                VStack {
                    HStack {
                        Text(rank)
                            .font(.system(size: fontSize, weight: .semibold, design: .rounded))
                            .foregroundStyle(labelColor)
                            .padding(2)
                        Spacer(minLength: 0)
                    }
                    Spacer(minLength: 0)
                }
            }

            if let file = fileLabelForOverlay {
                VStack {
                    Spacer(minLength: 0)
                    HStack {
                        Spacer(minLength: 0)
                        Text(file)
                            .font(.system(size: fontSize, weight: .semibold, design: .rounded))
                            .foregroundStyle(labelColor)
                            .padding(2)
                    }
                }
            }
        }
        .allowsHitTesting(false)
    }

    private var rankLabelForOverlay: String? {
        guard BoardConstants.playableRange.contains(square.row) else { return nil }
        let leftCol = viewModel.boardFlipped
            ? BoardConstants.playableRange.upperBound
            : BoardConstants.playableRange.lowerBound
        guard square.col == leftCol else { return nil }
        return BoardConstants.standardRankLabel(row: square.row)
    }

    private var fileLabelForOverlay: String? {
        guard BoardConstants.playableRange.contains(square.col) else { return nil }
        let bottomRow = viewModel.boardFlipped
            ? BoardConstants.playableRange.lowerBound
            : BoardConstants.playableRange.upperBound
        guard square.row == bottomRow else { return nil }
        return BoardConstants.standardFileLabel(col: square.col)
    }

    private var coordinateLabelColor: Color {
        let isLight = (square.row + square.col) % 2 == 0
        return isLight ? Color.black.opacity(0.55) : Color.white.opacity(0.72)
    }
}

private struct MoveAnimationOverlay: View {
    let animation: ActiveMoveAnimation
    let squareSize: CGFloat
    let displayRows: [Int]
    let displayCols: [Int]

    @State private var traveled = false

    var body: some View {
        PieceView(piece: animation.piece)
            .frame(width: squareSize, height: squareSize)
            .position(point(for: traveled ? animation.move.to : animation.move.from))
            .id(animation.move)
            .onAppear {
                traveled = false
                withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                    traveled = true
                }
            }
            .onChange(of: animation.move) { _, _ in
                traveled = false
                withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                    traveled = true
                }
            }
    }

    private func point(for square: Square) -> CGPoint {
        guard let rowIdx = displayRows.firstIndex(of: square.row),
              let colIdx = displayCols.firstIndex(of: square.col) else {
            return .zero
        }
        return CGPoint(
            x: (CGFloat(colIdx) + 0.5) * squareSize,
            y: (CGFloat(rowIdx) + 0.5) * squareSize
        )
    }
}

struct BoardView: View {
    @ObservedObject var viewModel: GameViewModel

    private var displayRows: [Int] {
        viewModel.boardFlipped ? Array((0..<BoardConstants.size).reversed()) : Array(0..<BoardConstants.size)
    }

    private var displayCols: [Int] {
        viewModel.boardFlipped ? Array((0..<BoardConstants.size).reversed()) : Array(0..<BoardConstants.size)
    }

    var body: some View {
        GeometryReader { geo in
            let boardSize = min(geo.size.width, geo.size.height)
            let squareSize = boardSize / CGFloat(BoardConstants.size)

            boardGrid(squareSize: squareSize, boardSize: boardSize)
                .frame(width: boardSize, height: boardSize)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .animation(.easeOut(duration: 0.2), value: viewModel.previewPly)
    }

    @ViewBuilder
    private func boardGrid(squareSize: CGFloat, boardSize: CGFloat) -> some View {
        ZStack {
            VStack(spacing: 0) {
                ForEach(displayRows, id: \.self) { row in
                    HStack(spacing: 0) {
                        ForEach(displayCols, id: \.self) { col in
                            SquareView(
                                square: Square(row: row, col: col),
                                viewModel: viewModel,
                                squareSize: squareSize
                            )
                            .frame(width: squareSize, height: squareSize)
                        }
                    }
                }
            }

            playableFrameOverlay(squareSize: squareSize, boardSize: boardSize)
        }
        .overlay {
            if let animation = viewModel.activeMoveAnimation {
                MoveAnimationOverlay(
                    animation: animation,
                    squareSize: squareSize,
                    displayRows: displayRows,
                    displayCols: displayCols
                )
                .allowsHitTesting(false)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color.black.opacity(0.25), lineWidth: 2)
        )
    }

    @ViewBuilder
    private func playableFrameOverlay(squareSize: CGFloat, boardSize: CGFloat) -> some View {
        let rowIndices = displayRows.enumerated()
            .filter { BoardConstants.playableRange.contains($0.element) }
            .map(\.offset)
        let colIndices = displayCols.enumerated()
            .filter { BoardConstants.playableRange.contains($0.element) }
            .map(\.offset)
        if let rowMin = rowIndices.min(), let rowMax = rowIndices.max(),
           let colMin = colIndices.min(), let colMax = colIndices.max() {
            let width = squareSize * CGFloat(colMax - colMin + 1)
            let height = squareSize * CGFloat(rowMax - rowMin + 1)
            RoundedRectangle(cornerRadius: 2)
                .stroke(Color.black.opacity(0.12), lineWidth: 1)
                .frame(width: width, height: height)
                .position(
                    x: (CGFloat(colMin) + CGFloat(colMax - colMin + 1) / 2) * squareSize,
                    y: (CGFloat(rowMin) + CGFloat(rowMax - rowMin + 1) / 2) * squareSize
                )
                .allowsHitTesting(false)
        }
    }
}
