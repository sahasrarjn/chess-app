import Foundation

enum MoveClassification: String, Equatable {
    case ok, inaccuracy, mistake, blunder
}

struct PositionEval: Equatable {
    let cp: Int?
    let mateIn: Int?

    static func cp(_ n: Int) -> PositionEval { PositionEval(cp: n, mateIn: nil) }
    static func mate(_ n: Int) -> PositionEval { PositionEval(cp: nil, mateIn: n) }
}

let mateCp = 10_000
let clampCp = 1_500
let winningCp = 300
let inaccuracyCp = 50
let mistakeCp = 150
let blunderCp = 300

func toWhiteRelative(scoreCp: Int?, mateIn: Int?, sideToMove: PieceColor) -> PositionEval {
    let sign = sideToMove == .white ? 1 : -1
    if let m = mateIn {
        if m == 0 { return PositionEval(cp: sign * -mateCp, mateIn: nil) }
        return PositionEval(cp: nil, mateIn: m * sign)
    }
    return PositionEval(cp: (scoreCp ?? 0) * sign, mateIn: nil)
}

func normalizedCp(_ e: PositionEval) -> Int {
    if let m = e.mateIn {
        let sign = m > 0 ? 1 : -1
        return sign * (mateCp - abs(m))
    }
    return max(-clampCp, min(clampCp, e.cp ?? 0))
}

func classifyMove(before: PositionEval, after: PositionEval, mover: PieceColor) -> MoveClassification {
    let sign = mover == .white ? 1 : -1
    let moverBefore = normalizedCp(before) * sign
    let moverAfter = normalizedCp(after) * sign

    let hadMate = before.mateIn != nil && before.mateIn! * sign > 0
    let hasMate = after.mateIn != nil && after.mateIn! * sign > 0
    let facedMate = before.mateIn != nil && before.mateIn! * sign < 0
    let facesMate = after.mateIn != nil && after.mateIn! * sign < 0

    if hadMate && !hasMate {
        return moverAfter >= winningCp ? .mistake : .blunder
    }
    if facesMate && !facedMate {
        return moverBefore >= -winningCp ? .blunder : .ok
    }

    let swing = max(0, moverBefore - moverAfter)
    if swing >= blunderCp { return .blunder }
    if swing >= mistakeCp { return .mistake }
    if swing >= inaccuracyCp { return .inaccuracy }
    return .ok
}
