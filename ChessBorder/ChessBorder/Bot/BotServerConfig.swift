import Foundation

/// Remote Fairy-Stockfish server URL (physical iPhone cannot run the engine locally).
enum BotServerConfig {
    private static let urlKey = "engineServerURL"
    private static let apiKeyKey = "engineServerAPIKey"

    /// Default from Info.plist `EngineServerURL`, overridden by UserDefaults.
    static var baseURL: URL? {
        let raw = UserDefaults.standard.string(forKey: urlKey)
            ?? Bundle.main.object(forInfoDictionaryKey: "EngineServerURL") as? String
            ?? ""
        return normalizedURL(from: raw)
    }

    static var urlString: String {
        get {
            UserDefaults.standard.string(forKey: urlKey)
                ?? Bundle.main.object(forInfoDictionaryKey: "EngineServerURL") as? String
                ?? ""
        }
        set {
            UserDefaults.standard.set(newValue, forKey: urlKey)
        }
    }

    static var apiKey: String? {
        let raw = UserDefaults.standard.string(forKey: apiKeyKey)
            ?? Bundle.main.object(forInfoDictionaryKey: "EngineServerAPIKey") as? String
            ?? ""
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static var apiKeyString: String {
        get { UserDefaults.standard.string(forKey: apiKeyKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: apiKeyKey) }
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
