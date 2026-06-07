import Foundation

// MARK: - Protocol (mirrors the web/server JSON)

enum OnlineRole: String, Codable {
    case white, black, spectator
}

struct OnlinePlayer: Codable, Equatable {
    let name: String
    let connected: Bool
}

struct OnlineResult: Codable, Equatable {
    let type: String        // ongoing | checkmate | stalemate | resignation | draw
    let winner: String?     // white | black
    let reason: String?
}

struct OnlineState: Codable {
    struct Players: Codable {
        let white: OnlinePlayer?
        let black: OnlinePlayer?
    }
    let roomId: String
    let role: OnlineRole
    let color: String?      // white | black | nil (spectator)
    let players: Players
    let moves: [String]
    let status: String      // waiting | active | finished
    let result: OnlineResult
    let yourTurn: Bool
    let rematchOfferedBy: String?

    var pieceColor: PieceColor? {
        switch color {
        case "white": return .white
        case "black": return .black
        default: return nil
        }
    }
}

/// Messages received from the server.
enum ServerMessage {
    case state(OnlineState)
    case error(String)

    private struct TypeProbe: Decodable { let type: String }
    private struct ErrorBody: Decodable { let message: String }

    static func parse(_ text: String) -> ServerMessage? {
        guard let data = text.data(using: .utf8) else { return nil }
        let decoder = JSONDecoder()
        guard let probe = try? decoder.decode(TypeProbe.self, from: data) else { return nil }
        switch probe.type {
        case "state":
            return (try? decoder.decode(OnlineState.self, from: data)).map(ServerMessage.state)
        case "error":
            return (try? decoder.decode(ErrorBody.self, from: data)).map { .error($0.message) }
        default:
            return nil
        }
    }
}

/// Messages sent to the server.
enum ClientMessage: Encodable {
    case join(roomId: String, token: String, name: String)
    case move(uci: String)
    case rematch

    private enum CodingKeys: String, CodingKey { case type, roomId, token, name, uci }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .join(roomId, token, name):
            try c.encode("join", forKey: .type)
            try c.encode(roomId, forKey: .roomId)
            try c.encode(token, forKey: .token)
            try c.encode(name, forKey: .name)
        case let .move(uci):
            try c.encode("move", forKey: .type)
            try c.encode(uci, forKey: .uci)
        case .rematch:
            try c.encode("rematch", forKey: .type)
        }
    }
}

// MARK: - Config

enum MultiplayerConfig {
    static var serverURL: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "MultiplayerServerURL") as? String,
              !raw.isEmpty,
              let url = URL(string: raw) else { return nil }
        return url
    }
    static var isConfigured: Bool { serverURL != nil }

    /// Web URL used for share links so non-app friends can join in a browser.
    static func shareURL(roomId: String) -> URL? {
        URL(string: "https://borderchess.org/play/?room=\(roomId)")
    }
}

// MARK: - Identity

enum OnlineIdentity {
    private static let tokenKey = "bc_player_token"
    private static let nameKey = "bc_guest_name"

    private static let adjectives = [
        "Brave", "Swift", "Clever", "Bold", "Calm", "Sly", "Quick", "Wise",
        "Lucky", "Noble", "Sharp", "Daring", "Steady", "Fierce", "Royal",
    ]
    private static let nouns = [
        "Knight", "Bishop", "Rook", "Pawn", "Castle", "Gambit", "Tactician",
        "Champion", "Challenger", "Player", "Rival",
    ]

    static var token: String {
        if let t = UserDefaults.standard.string(forKey: tokenKey) { return t }
        let t = UUID().uuidString
        UserDefaults.standard.set(t, forKey: tokenKey)
        return t
    }

    static var name: String {
        if let n = UserDefaults.standard.string(forKey: nameKey) { return n }
        let n = "\(adjectives.randomElement()!) \(nouns.randomElement()!) \(Int.random(in: 100...999))"
        UserDefaults.standard.set(n, forKey: nameKey)
        return n
    }

    static func setName(_ value: String) {
        let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
        UserDefaults.standard.set(cleaned.isEmpty ? "Guest" : String(cleaned.prefix(24)), forKey: nameKey)
    }

    /// Short, easy-to-type/share room id.
    static func newRoomCode() -> String {
        let chars = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return String((0..<6).map { _ in chars.randomElement()! })
    }

    /// Accept a raw code or a pasted share URL; return the room id.
    static func roomId(fromInput input: String) -> String? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        if let comps = URLComponents(string: trimmed),
           let room = comps.queryItems?.first(where: { $0.name == "room" })?.value,
           !room.isEmpty {
            return room
        }
        // Bare code: keep url-safe characters only.
        let code = trimmed.lowercased().filter { $0.isLetter || $0.isNumber }
        return code.isEmpty ? nil : code
    }
}

// MARK: - WebSocket client

@MainActor
final class OnlineSocket {
    enum Status { case connecting, open, reconnecting, closed }

    var onMessage: ((ServerMessage) -> Void)?
    var onStatus: ((Status) -> Void)?
    var onOpen: (() -> Void)?

    private let url: URL
    private let session = URLSession(configuration: .default)
    private var task: URLSessionWebSocketTask?
    private var closedByUser = false
    private var backoff: TimeInterval = 0.5

    init(url: URL) {
        self.url = url
    }

    func connect() {
        closedByUser = false
        openSocket(first: true)
    }

    private func openSocket(first: Bool) {
        onStatus?(first ? .connecting : .reconnecting)
        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()
        // The task buffers sends until the handshake completes, so resending
        // join now is safe and re-seats us on reconnect.
        onOpen?()
        listen(on: task)
    }

    private func listen(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            switch result {
            case .success(let message):
                if case .string(let text) = message, let parsed = ServerMessage.parse(text) {
                    Task { @MainActor [weak self] in
                        guard let self, self.task === task else { return }
                        self.backoff = 0.5
                        self.onStatus?(.open)
                        self.onMessage?(parsed)
                    }
                }
                self?.listen(on: task)
            case .failure:
                Task { @MainActor [weak self] in
                    guard let self, self.task === task else { return }
                    self.handleDrop()
                }
            }
        }
    }

    private func handleDrop() {
        guard !closedByUser else {
            onStatus?(.closed)
            return
        }
        onStatus?(.reconnecting)
        let delay = backoff
        backoff = min(backoff * 2, 8)
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard let self, !self.closedByUser else { return }
            self.openSocket(first: false)
        }
    }

    func send(_ message: ClientMessage) {
        guard let data = try? JSONEncoder().encode(message),
              let text = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(text)) { _ in }
    }

    func close() {
        closedByUser = true
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        onStatus?(.closed)
    }
}
