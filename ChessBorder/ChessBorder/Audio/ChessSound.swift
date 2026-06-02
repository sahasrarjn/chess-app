import AVFoundation

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Distinct sound cues. Raw values match the asset names under
/// `Assets.xcassets/Sounds/<event>.dataset` (and `web/public/sounds/<event>.mp3`).
enum MoveSoundEvent: String, CaseIterable {
    case move
    case capture
    case check
    case castle
    case promote
    case gameStart = "game-start"
    case gameEnd = "game-end"
    case illegal
}

/// Pick the single cue for a just-applied move. Priority, high to low:
/// game-end > check > promote > castle > capture > move.
/// Mirrors `web/src/audio/classifyMoveSound.ts`.
func classifyMoveSound(
    result: GameResult,
    givesCheck: Bool,
    captured: Bool,
    move: Move
) -> MoveSoundEvent {
    switch result {
    case .checkmate, .stalemate, .draw:
        return .gameEnd
    case .ongoing, .resignation:
        break
    }
    if givesCheck { return .check }
    if move.promotion != nil { return .promote }
    if move.isCastle { return .castle }
    if captured { return .capture }
    return .move
}

/// Plays the move sound effects, loaded from the asset catalog.
///
/// Each cue keeps a small pool of `AVAudioPlayer`s so rapid repeats (e.g. fast
/// moves) don't cut each other off. All failures are swallowed: audio must
/// never interrupt play.
@MainActor
final class ChessSoundPlayer {
    static let shared = ChessSoundPlayer()

    private static let mutedKey = "bc_sound_muted"
    private static let poolSize = 3

    private var pools: [MoveSoundEvent: [AVAudioPlayer]] = [:]
    private var sessionConfigured = false

    var isMuted: Bool {
        get { UserDefaults.standard.bool(forKey: Self.mutedKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.mutedKey) }
    }

    private init() {
        preload()
    }

    @discardableResult
    func toggleMuted() -> Bool {
        isMuted.toggle()
        return isMuted
    }

    func play(_ event: MoveSoundEvent) {
        guard !isMuted else { return }
        configureSessionIfNeeded()
        guard let pool = pools[event], !pool.isEmpty else { return }
        let player = pool.first(where: { !$0.isPlaying }) ?? pool[0]
        player.currentTime = 0
        player.play()
    }

    private func preload() {
        for event in MoveSoundEvent.allCases {
            guard let asset = NSDataAsset(name: "Sounds/\(event.rawValue)") else { continue }
            var pool: [AVAudioPlayer] = []
            for _ in 0..<Self.poolSize {
                if let player = try? AVAudioPlayer(data: asset.data, fileTypeHint: "mp3") {
                    player.prepareToPlay()
                    pool.append(player)
                }
            }
            if !pool.isEmpty { pools[event] = pool }
        }
    }

    private func configureSessionIfNeeded() {
        #if os(iOS)
        guard !sessionConfigured else { return }
        sessionConfigured = true
        // Ambient + mix so move sounds never stop the user's music.
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
        try? session.setActive(true)
        #endif
    }
}
