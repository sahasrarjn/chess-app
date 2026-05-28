import Foundation

/// Remote Fairy-Stockfish server — configured in Info.plist (not shown in UI).
/// Production builds point at the Cloudflare worker URL only; the worker holds the backend API key.
enum BotServerConfig {
    static var baseURL: URL? {
        normalizedURL(from: urlString)
    }

    static var urlString: String {
        Bundle.main.object(forInfoDictionaryKey: "EngineServerURL") as? String ?? ""
    }

    static var apiKey: String? {
        let raw = Bundle.main.object(forInfoDictionaryKey: "EngineServerAPIKey") as? String ?? ""
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static var isConfigured: Bool {
        baseURL != nil
    }

    static func normalizedURL(from raw: String) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") {
            return URL(string: trimmed)
        }
        return URL(string: "https://\(trimmed)")
    }
}
