import SwiftUI
import AuthenticationServices

struct SignInView: View {
    let onContinueAsGuest: () -> Void

    @StateObject private var auth = AuthStore.shared
    @State private var errorMessage: String? = nil
    @State private var isSigningIn = false

    var body: some View {
        ZStack {
            BoardTheme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Branding
                VStack(spacing: 12) {
                    Image("AppIcon")
                        .resizable()
                        .frame(width: 88, height: 88)
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))

                    Text("Border Chess")
                        .font(.largeTitle.bold())
                        .foregroundStyle(.white)

                    Text("10×10 border chess")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.6))
                }
                .padding(.bottom, 32)

                // Card
                VStack(spacing: 20) {
                    Text("Sign in to track games, appear on the leaderboard, and replay your history.")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.65))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)

                    // Apple Sign-In
                    SignInWithAppleButton(.signIn) { request in
                        request.requestedScopes = [.email, .fullName]
                    } onCompletion: { result in
                        handleAppleResult(result)
                    }
                    .signInWithAppleButtonStyle(.white)
                    .frame(height: 50)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                    // Google Sign-In
                    #if os(iOS) && canImport(GoogleSignIn)
                    GoogleSignInButton(onResult: handleGoogleResult)
                    #endif

                    if let error = errorMessage {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(Color(red: 1, green: 0.54, blue: 0.5))
                            .multilineTextAlignment(.center)
                    }

                    // Divider
                    HStack {
                        Rectangle().fill(.white.opacity(0.15)).frame(height: 1)
                        Text("or").font(.caption).foregroundStyle(.white.opacity(0.4))
                        Rectangle().fill(.white.opacity(0.15)).frame(height: 1)
                    }

                    // Guest
                    Button(action: onContinueAsGuest) {
                        Text("Continue as Guest")
                            .font(.subheadline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(.white.opacity(0.25), lineWidth: 1)
                            )
                            .foregroundStyle(.white.opacity(0.75))
                    }
                }
                .padding(24)
                .background(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(BoardTheme.surface)
                )
                .padding(.horizontal, 24)

                Spacer()
                Spacer()
            }

            if isSigningIn {
                Color.black.opacity(0.4).ignoresSafeArea()
                ProgressView().tint(.white).scaleEffect(1.5)
            }
        }
    }

    private func handleAppleResult(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let auth):
            guard
                let cred = auth.credential as? ASAuthorizationAppleIDCredential,
                let tokenData = cred.identityToken,
                let idToken = String(data: tokenData, encoding: .utf8)
            else {
                errorMessage = "Apple sign-in failed. Please try again."
                return
            }
            isSigningIn = true
            errorMessage = nil
            Task {
                await signIn(provider: "apple", idToken: idToken,
                             nameHint: [cred.fullName?.givenName, cred.fullName?.familyName]
                                 .compactMap { $0 }.joined(separator: " ")
                                 .nilIfEmpty)
            }
        case .failure(let error as ASAuthorizationError)
            where error.code == .canceled:
            break  // user dismissed
        case .failure:
            errorMessage = "Apple sign-in failed. Please try again."
        }
    }

    #if os(iOS) && canImport(GoogleSignIn)
    private func handleGoogleResult(_ idToken: String?) {
        guard let token = idToken else {
            errorMessage = "Google sign-in failed. Please try again."
            return
        }
        isSigningIn = true
        errorMessage = nil
        Task { await signIn(provider: "google", idToken: token, nameHint: nil) }
    }
    #endif

    @MainActor
    private func signIn(provider: String, idToken: String, nameHint: String?) async {
        do {
            try await auth.signIn(provider: provider, idToken: idToken, nameHint: nameHint)
            isSigningIn = false
        } catch {
            isSigningIn = false
            errorMessage = "Sign-in failed. Try again or continue as guest."
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

#Preview {
    SignInView(onContinueAsGuest: {})
}
