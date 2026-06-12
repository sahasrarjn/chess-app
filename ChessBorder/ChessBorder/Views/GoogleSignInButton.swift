#if os(iOS) && canImport(GoogleSignIn)
import SwiftUI
import GoogleSignIn

/// A styled "Sign in with Google" button that triggers the GIDSignIn flow
/// and calls onResult with the id token string (or nil on failure/cancel).
struct GoogleSignInButton: View {
    let onResult: (String?) -> Void

    var body: some View {
        Button(action: triggerSignIn) {
            HStack(spacing: 10) {
                // Google logo placeholder (white G)
                ZStack {
                    Circle().fill(.white).frame(width: 24, height: 24)
                    Text("G")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color(red: 0.26, green: 0.52, blue: 0.96))
                }
                Text("Sign in with Google")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.black)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func triggerSignIn() {
        guard AccountsConfig.isGoogleConfigured,
              let clientID = AccountsConfig.googleClientID,
              let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let root = scene.windows.first?.rootViewController
        else {
            onResult(nil)
            return
        }

        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
        GIDSignIn.sharedInstance.signIn(withPresenting: root) { result, error in
            if error != nil {
                onResult(nil)
                return
            }
            onResult(result?.user.idToken?.tokenString)
        }
    }
}
#endif
