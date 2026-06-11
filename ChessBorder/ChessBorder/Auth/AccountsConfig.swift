import Foundation

enum AccountsConfig {
    static var serverURL: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "AccountsServerURL") as? String,
              !raw.isEmpty,
              let url = URL(string: raw) else { return nil }
        return url
    }

    static var googleClientID: String? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "GoogleClientID") as? String,
              !raw.isEmpty else { return nil }
        return raw
    }

    /// Sign-in UI renders only when the API is configured.
    /// Apple sign-in needs only the server; Google additionally needs a client ID.
    static var isConfigured: Bool { serverURL != nil }
    static var isGoogleConfigured: Bool { serverURL != nil && googleClientID != nil }
}
