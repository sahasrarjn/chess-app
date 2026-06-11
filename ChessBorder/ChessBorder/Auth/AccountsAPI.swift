import Foundation

// MARK: - Models

struct UserProfile: Codable, Equatable {
    let userId: String
    let email: String
    var displayName: String
    let avatarUrl: String?
    let createdAt: String
}

struct LoginResponse: Codable {
    let token: String
    let profile: UserProfile
}

private struct MeEnvelope: Codable {
    let profile: UserProfile
}

struct GamePage: Codable {
    let games: [CompletedGameRecord]
    let nextCursor: String?
}

private struct GameEnvelope: Codable { let game: CompletedGameRecord }

enum AccountsAPIError: Error {
    case http(Int)
    case invalidResponse
}

// MARK: - Client

struct AccountsAPI {
    let baseURL: URL
    var session: URLSession = .shared

    /// POST /v1/auth/login {provider, idToken, name?}
    func login(provider: String, idToken: String, name: String?) async throws -> LoginResponse {
        var request = URLRequest(url: baseURL.appending(path: "v1/auth/login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = ["provider": provider, "idToken": idToken]
        if let name { body["name"] = name }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AccountsAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw AccountsAPIError.http(http.statusCode) }
        return try JSONDecoder().decode(LoginResponse.self, from: data)
    }

    /// GET /v1/me (Bearer)
    func me(token: String) async throws -> UserProfile {
        var request = URLRequest(url: baseURL.appending(path: "v1/me"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AccountsAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw AccountsAPIError.http(http.statusCode) }
        return try JSONDecoder().decode(MeEnvelope.self, from: data).profile
    }

    /// POST /v1/games (Bearer). The server assigns its own gameId.
    func postGame(token: String, record: CompletedGameRecord) async throws -> CompletedGameRecord {
        var request = URLRequest(url: baseURL.appending(path: "v1/games"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(record)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AccountsAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw AccountsAPIError.http(http.statusCode) }
        return try JSONDecoder().decode(GameEnvelope.self, from: data).game
    }

    /// GET /v1/games[?cursor=] (Bearer)
    func listGames(token: String, cursor: String?) async throws -> GamePage {
        var comps = URLComponents(url: baseURL.appending(path: "v1/games"), resolvingAgainstBaseURL: false)!
        if let cursor {
            comps.queryItems = [URLQueryItem(name: "cursor", value: cursor)]
        }
        var request = URLRequest(url: comps.url ?? baseURL.appending(path: "v1/games"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AccountsAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw AccountsAPIError.http(http.statusCode) }
        return try JSONDecoder().decode(GamePage.self, from: data)
    }

    /// POST /v1/me {displayName} (Bearer)
    func updateDisplayName(token: String, displayName: String) async throws -> UserProfile {
        var request = URLRequest(url: baseURL.appending(path: "v1/me"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["displayName": displayName])

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AccountsAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw AccountsAPIError.http(http.statusCode) }
        return try JSONDecoder().decode(MeEnvelope.self, from: data).profile
    }
}
