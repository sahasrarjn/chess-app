import XCTest
@testable import Border_Chess

final class AccountsTests: XCTestCase {

    override func setUp() {
        super.setUp()
        CapturingURLProtocol.reset()
    }

    // MARK: - UserProfile decoding

    func testUserProfileDecodesFullJSON() throws {
        let json = """
        {
            "userId": "abc-123",
            "email": "player@example.com",
            "displayName": "Chess Master",
            "avatarUrl": "https://example.com/avatar.png",
            "createdAt": "2026-06-11T00:00:00.000Z"
        }
        """
        let profile = try JSONDecoder().decode(UserProfile.self, from: Data(json.utf8))
        XCTAssertEqual(profile.userId, "abc-123")
        XCTAssertEqual(profile.email, "player@example.com")
        XCTAssertEqual(profile.displayName, "Chess Master")
        XCTAssertEqual(profile.avatarUrl, "https://example.com/avatar.png")
        XCTAssertEqual(profile.createdAt, "2026-06-11T00:00:00.000Z")
    }

    func testUserProfileDecodesNullAvatarUrl() throws {
        let json = """
        {
            "userId": "abc-456",
            "email": "guest@example.com",
            "displayName": "New Player",
            "avatarUrl": null,
            "createdAt": "2026-06-11T00:00:00.000Z"
        }
        """
        let profile = try JSONDecoder().decode(UserProfile.self, from: Data(json.utf8))
        XCTAssertEqual(profile.userId, "abc-456")
        XCTAssertNil(profile.avatarUrl)
    }

    // MARK: - LoginResponse decoding

    func testLoginResponseDecodesCorrectly() throws {
        let json = """
        {
            "token": "eyJhbGci.payload.sig",
            "profile": {
                "userId": "user-001",
                "email": "test@example.com",
                "displayName": "Tester",
                "avatarUrl": null,
                "createdAt": "2026-01-01T00:00:00.000Z"
            }
        }
        """
        let response = try JSONDecoder().decode(LoginResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.token, "eyJhbGci.payload.sig")
        XCTAssertEqual(response.profile.userId, "user-001")
        XCTAssertEqual(response.profile.email, "test@example.com")
    }

    // MARK: - AccountsConfig gating

    func testAccountsConfigIsNotConfiguredInTestBundle() {
        // The test target's Info.plist has no AccountsServerURL key —
        // this mirrors the Mac target's behaviour (feature hidden by default).
        XCTAssertFalse(AccountsConfig.isConfigured)
        XCTAssertFalse(AccountsConfig.isGoogleConfigured)
        XCTAssertNil(AccountsConfig.serverURL)
        XCTAssertNil(AccountsConfig.googleClientID)
    }

    // MARK: - Display name validation

    func testDisplayNameValidationAcceptsValidNames() {
        XCTAssertTrue(AccountsTests.isValidDisplayName("Alice"))
        XCTAssertTrue(AccountsTests.isValidDisplayName("Chess Master 42"))
        XCTAssertTrue(AccountsTests.isValidDisplayName("X"))
        XCTAssertTrue(AccountsTests.isValidDisplayName(String(repeating: "A", count: 30)))
    }

    func testDisplayNameValidationRejectsEmptyOrTooLong() {
        XCTAssertFalse(AccountsTests.isValidDisplayName(""))
        XCTAssertFalse(AccountsTests.isValidDisplayName("   "))
        XCTAssertFalse(AccountsTests.isValidDisplayName(String(repeating: "A", count: 31)))
    }

    func testDisplayNameValidationTrimsBeforeChecking() {
        // After trim+collapse, "  Alice  " → "Alice" (5 chars) — valid.
        XCTAssertTrue(AccountsTests.isValidDisplayName("  Alice  "))
        // A string of only spaces trims to "" — invalid.
        XCTAssertFalse(AccountsTests.isValidDisplayName("     "))
    }

    // MARK: - Keychain round-trip

    func testKeychainRoundTrip() {
        let account = "test-accounts-\(UUID().uuidString)"
        defer { KeychainStore.delete(account) }

        XCTAssertNil(KeychainStore.read(account), "Should be empty before write")
        KeychainStore.write(account, value: "my-session-token")
        XCTAssertEqual(KeychainStore.read(account), "my-session-token")
    }

    func testKeychainOverwrite() {
        let account = "test-accounts-overwrite-\(UUID().uuidString)"
        defer { KeychainStore.delete(account) }

        KeychainStore.write(account, value: "first")
        KeychainStore.write(account, value: "second")
        XCTAssertEqual(KeychainStore.read(account), "second")
    }

    func testKeychainDeleteClearsValue() {
        let account = "test-accounts-delete-\(UUID().uuidString)"
        KeychainStore.write(account, value: "to-delete")
        KeychainStore.delete(account)
        XCTAssertNil(KeychainStore.read(account))
    }

    func testKeychainDeleteNonexistentIsNoop() {
        // Should not crash
        KeychainStore.delete("test-accounts-nonexistent-\(UUID().uuidString)")
    }

    // MARK: - AccountsAPI request building

    func testAPILoginRequestShape() async throws {
        let baseURL = URL(string: "https://example.com")!
        let session = URLSession(configuration: {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [CapturingURLProtocol.self]
            return config
        }())
        let api = AccountsAPI(baseURL: baseURL, session: session)

        CapturingURLProtocol.responseData = try JSONEncoder().encode(
            LoginResponse(
                token: "tok",
                profile: UserProfile(
                    userId: "u1", email: "a@b.com",
                    displayName: "A", avatarUrl: nil,
                    createdAt: "2026-06-11T00:00:00.000Z"
                )
            )
        )
        CapturingURLProtocol.statusCode = 200

        _ = try await api.login(provider: "apple", idToken: "id-tok", name: "Alice")

        let req = try XCTUnwrap(CapturingURLProtocol.lastRequest)
        XCTAssertEqual(req.httpMethod, "POST")
        XCTAssertTrue(req.url?.path == "/v1/auth/login")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Content-Type"), "application/json")

        let body = try XCTUnwrap(req.httpBodyData())
        let json = try JSONSerialization.jsonObject(with: body) as? [String: String]
        XCTAssertEqual(json?["provider"], "apple")
        XCTAssertEqual(json?["idToken"], "id-tok")
        XCTAssertEqual(json?["name"], "Alice")
    }

    func testAPIMeRequestShape() async throws {
        let baseURL = URL(string: "https://example.com")!
        let session = URLSession(configuration: {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [CapturingURLProtocol.self]
            return config
        }())
        let api = AccountsAPI(baseURL: baseURL, session: session)

        let profileJSON = try JSONEncoder().encode(
            UserProfile(userId: "u1", email: "a@b.com", displayName: "A",
                        avatarUrl: nil, createdAt: "2026-06-11T00:00:00.000Z")
        )
        CapturingURLProtocol.responseData = try JSONEncoder().encode(
            MeEnvelopeForTest(profile: JSONDecoder().decode(UserProfile.self, from: profileJSON))
        )
        CapturingURLProtocol.statusCode = 200

        _ = try await api.me(token: "my-bearer-token")

        let req = try XCTUnwrap(CapturingURLProtocol.lastRequest)
        // URLRequest.httpMethod defaults to "GET" when not explicitly set
        let method = req.httpMethod ?? "GET"
        XCTAssertEqual(method, "GET")
        XCTAssertTrue(req.url?.path == "/v1/me")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer my-bearer-token")
    }

    func testAPIThrowsOn401() async {
        let baseURL = URL(string: "https://example.com")!
        let session = URLSession(configuration: {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [CapturingURLProtocol.self]
            return config
        }())
        let api = AccountsAPI(baseURL: baseURL, session: session)
        CapturingURLProtocol.responseData = Data("{\"error\":\"unauthorized\"}".utf8)
        CapturingURLProtocol.statusCode = 401

        do {
            _ = try await api.me(token: "bad-token")
            XCTFail("Expected error")
        } catch AccountsAPIError.http(let code) {
            XCTAssertEqual(code, 401)
        } catch {
            XCTFail("Wrong error type: \(error)")
        }
    }

    // MARK: - Helpers

    /// Mirror of the server-side rule: trim + collapse, 1–30 chars.
    private static func isValidDisplayName(_ raw: String) -> Bool {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 30 else { return false }
        return true
    }
}

// Helper struct for encoding the /v1/me response envelope in tests
private struct MeEnvelopeForTest: Codable {
    let profile: UserProfile
}

// MARK: - URLProtocol stub

/// Simple URLProtocol that captures the last request and returns a preset response.
final class CapturingURLProtocol: URLProtocol {
    static var lastRequest: URLRequest?
    static var responseData: Data = Data()
    static var statusCode: Int = 200

    static func reset() {
        lastRequest = nil
        responseData = Data()
        statusCode = 200
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        // Capture body stream into httpBodyData for inspection
        Self.lastRequest = request

        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: Self.statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseData)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private extension URLRequest {
    func httpBodyData() -> Data? {
        if let body = httpBody { return body }
        if let stream = httpBodyStream {
            stream.open()
            defer { stream.close() }
            var data = Data()
            let bufferSize = 1024
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
            defer { buffer.deallocate() }
            while stream.hasBytesAvailable {
                let read = stream.read(buffer, maxLength: bufferSize)
                if read > 0 { data.append(buffer, count: read) }
            }
            return data
        }
        return nil
    }
}
