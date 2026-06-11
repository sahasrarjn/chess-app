import AuthenticationServices
import SwiftUI
#if canImport(GoogleSignIn)
import GoogleSignIn
#endif

@MainActor
final class AuthStore: NSObject, ObservableObject {
    static let shared = AuthStore()

    @Published private(set) var profile: UserProfile?
    @Published private(set) var isSigningIn = false
    @Published var lastError: String?

    private static let tokenAccount = "session"
    private var appleSignInController: ASAuthorizationController?
    private var isRestoring = false

    private var api: AccountsAPI? {
        AccountsConfig.serverURL.map { AccountsAPI(baseURL: $0) }
    }

    var isSignedIn: Bool { profile != nil }

    /// Stored session token, if any (for WebSocket attribution and game uploads).
    var sessionToken: String? { KeychainStore.read(Self.tokenAccount) }

    // MARK: - Restore

    /// Call at launch (SettingsView/HomeView .task): validate the stored token.
    /// Guard against duplicate concurrent calls (e.g. HomeView + SettingsView both running .task).
    func restore() async {
        guard !isRestoring else { return }
        isRestoring = true
        defer { isRestoring = false }

        guard let api,
              let token = KeychainStore.read(Self.tokenAccount) else { return }
        do {
            let p = try await api.me(token: token)
            profile = p
        } catch AccountsAPIError.http(401) {
            KeychainStore.delete(Self.tokenAccount)
        } catch {
            // Network error: keep token, leave profile nil (degrades to signed-out UI without destroying session).
            _ = error
        }
    }

    // MARK: - Sign in with Apple

    func signInWithApple() {
        let provider = ASAuthorizationAppleIDProvider()
        let request = provider.createRequest()
        request.requestedScopes = [.fullName, .email]

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        appleSignInController = controller
        controller.performRequests()
    }

    // MARK: - Sign in with Google

    #if os(iOS)
    func signInWithGoogle(presenting: UIViewController?) {
        #if canImport(GoogleSignIn)
        guard AccountsConfig.isGoogleConfigured,
              let clientID = AccountsConfig.googleClientID else { return }

        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)

        guard let presenter = presenting else { return }
        isSigningIn = true
        GIDSignIn.sharedInstance.signIn(withPresenting: presenter) { [weak self] result, error in
            Task { @MainActor in
                defer { self?.isSigningIn = false }
                if let error {
                    _ = error
                    self?.lastError = "Sign-in failed. You can keep playing as a guest."
                    return
                }
                guard let idToken = result?.user.idToken?.tokenString else {
                    self?.lastError = "Sign-in failed. You can keep playing as a guest."
                    return
                }
                await self?.loginToBackend(provider: "google", idToken: idToken, name: nil)
            }
        }
        #endif
    }
    #endif

    // MARK: - Sign out

    func signOut() {
        KeychainStore.delete(Self.tokenAccount)
        profile = nil
        GameUploadQueue.clearQueue()
        #if canImport(GoogleSignIn) && os(iOS)
        GIDSignIn.sharedInstance.signOut()
        #endif
    }

    // MARK: - Update display name

    func updateDisplayName(_ name: String) async {
        guard let api,
              let token = KeychainStore.read(Self.tokenAccount) else { return }
        do {
            let updated = try await api.updateDisplayName(token: token, displayName: name)
            profile = updated
        } catch {
            lastError = "Could not update display name."
        }
    }

    // MARK: - Backend login helper

    private func loginToBackend(provider: String, idToken: String, name: String?) async {
        guard let api else { return }
        do {
            let response = try await api.login(provider: provider, idToken: idToken, name: name)
            KeychainStore.write(Self.tokenAccount, value: response.token)
            profile = response.profile
        } catch {
            lastError = "Sign-in failed. You can keep playing as a guest."
        }
    }
}

// MARK: - ASAuthorizationControllerDelegate

extension AuthStore: ASAuthorizationControllerDelegate {
    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let idToken = String(data: tokenData, encoding: .utf8) else { return }

        let nameHint: String? = {
            guard let fullName = credential.fullName else { return nil }
            let formatter = PersonNameComponentsFormatter()
            let formatted = formatter.string(from: fullName)
            return formatted.isEmpty ? nil : formatted
        }()

        Task { @MainActor in
            await loginToBackend(provider: "apple", idToken: idToken, name: nameHint)
            appleSignInController = nil
        }
    }

    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        // User cancelled or error; never block play
        Task { @MainActor in
            defer { appleSignInController = nil }
            if let authError = error as? ASAuthorizationError,
               authError.code == .canceled { return }
            lastError = "Sign-in failed. You can keep playing as a guest."
        }
    }
}

// MARK: - ASAuthorizationControllerPresentationContextProviding

extension AuthStore: ASAuthorizationControllerPresentationContextProviding {
    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        #if os(iOS)
        // ASAuthorizationController always calls this on the main thread.
        assert(Thread.isMainThread, "presentationAnchor(for:) expected on main thread")
        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
            ?? ASPresentationAnchor()
        #else
        return ASPresentationAnchor()
        #endif
    }
}
