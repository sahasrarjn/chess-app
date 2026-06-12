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
                GoogleGLogo()
                    .frame(width: 20, height: 20)
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

/// Official Google G logo rendered via SwiftUI paths (viewBox 0 0 24 24).
private struct GoogleGLogo: View {
    var body: some View {
        Canvas { ctx, size in
            let s = size.width / 24

            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) }

            // Blue #4285F4 — right arm + right arc
            var blue = Path()
            blue.move(to: pt(22.56, 12.25))
            blue.addCurve(to: pt(22.36, 10), control1: pt(22.56, 11.47), control2: pt(22.49, 10.72))
            blue.addLine(to: pt(12, 10))
            blue.addLine(to: pt(12, 14.26))
            blue.addLine(to: pt(17.92, 14.26))
            blue.addCurve(to: pt(15.71, 17.57), control1: pt(17.66, 15.63), control2: pt(16.88, 16.79))
            blue.addLine(to: pt(15.71, 20.34))
            blue.addLine(to: pt(19.28, 20.34))
            blue.addCurve(to: pt(22.56, 12.25), control1: pt(21.36, 18.42), control2: pt(22.56, 15.6))
            blue.closeSubpath()
            ctx.fill(blue, with: .color(Color(red: 66/255, green: 133/255, blue: 244/255)))

            // Green #34A853 — bottom arc
            var green = Path()
            green.move(to: pt(12, 23))
            green.addCurve(to: pt(19.28, 20.34), control1: pt(14.97, 23), control2: pt(17.46, 22.02))
            green.addLine(to: pt(15.71, 17.57))
            green.addCurve(to: pt(12, 18.63), control1: pt(14.73, 18.23), control2: pt(13.48, 18.63))
            green.addCurve(to: pt(5.84, 14.1), control1: pt(9.14, 18.63), control2: pt(6.71, 16.7))
            green.addLine(to: pt(2.18, 14.1))
            green.addLine(to: pt(2.18, 16.94))
            green.addCurve(to: pt(12, 23), control1: pt(3.99, 20.53), control2: pt(7.7, 23))
            green.closeSubpath()
            ctx.fill(green, with: .color(Color(red: 52/255, green: 168/255, blue: 83/255)))

            // Yellow #FBBC05 — left arc
            var yellow = Path()
            yellow.move(to: pt(5.84, 14.09))
            yellow.addCurve(to: pt(5.49, 12), control1: pt(5.62, 13.43), control2: pt(5.49, 12.73))
            yellow.addCurve(to: pt(5.84, 9.91), control1: pt(5.49, 11.27), control2: pt(5.62, 10.57))
            yellow.addLine(to: pt(5.84, 7.07))
            yellow.addLine(to: pt(2.18, 7.07))
            yellow.addCurve(to: pt(2.18, 16.93), control1: pt(1.43, 8.55), control2: pt(1, 10.22))
            yellow.closeSubpath()
            ctx.fill(yellow, with: .color(Color(red: 251/255, green: 188/255, blue: 5/255)))

            // Red #EA4335 — top arc
            var red = Path()
            red.move(to: pt(12, 5.38))
            red.addCurve(to: pt(16.21, 7.02), control1: pt(13.62, 5.38), control2: pt(15.06, 5.94))
            red.addLine(to: pt(19.36, 3.87))
            red.addCurve(to: pt(12, 1), control1: pt(17.45, 2.09), control2: pt(14.97, 1))
            red.addCurve(to: pt(5.84, 9.91), control1: pt(7.7, 1), control2: pt(3.99, 3.47))
            red.addLine(to: pt(5.84, 7.07))  // corrected: connects to yellow hand-off
            // close up through bottom of top arc
            red.addCurve(to: pt(12, 5.38), control1: pt(6.71, 7.31), control2: pt(9.14, 5.38))
            red.closeSubpath()
            ctx.fill(red, with: .color(Color(red: 234/255, green: 67/255, blue: 53/255)))
        }
    }
}
#endif
