# ChessBorder release scripts

Scripts for building and publishing Border Chess on iOS (OTA ad-hoc), macOS (Developer ID direct download), and the **Mac App Store**.

| Script | Purpose |
|--------|---------|
| `release-ios.sh` | Archive + export ad-hoc IPA for personal iPhone |
| `publish-release.sh` | Upload IPA + OTA manifest to S3 / CloudFront |
| `release-mac.sh` | Developer ID build, DMG, optional notarization (direct download) |
| `release-appstore-mac.sh` | **Mac App Store** archive, export `.pkg`, optional upload |
| `sign-and-notarize.sh` | Developer ID signing + notarization helpers |
| `release-env.sh` | Shared `.env` loading and Apple credential helpers |

Environment variables are loaded from the repo-root `.env` (or `../personal-brain/.env`).

---

## Mac App Store publish workflow

Distribution uses **Apple’s install and auto-update** (Mac App Store / TestFlight). This is separate from the Developer ID direct-download flow in `release-mac.sh`.

**Bundle ID:** `com.sahasraranjan.chessborder.mac`  
**Product name:** Border Chess  
**Team ID:** `LG3L588JT3` (personal — Sahasra Ranjan)

### 1. One-time App Store Connect setup

1. Sign in to [App Store Connect](https://appstoreconnect.apple.com).
2. **My Apps → + → New App**
   - Platform: **macOS**
   - Name: **Border Chess**
   - Primary language: your choice
   - Bundle ID: **com.sahasraranjan.chessborder.mac** (register in [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list) first if needed)
   - SKU: e.g. `chessborder-mac`
3. Complete **App Information**, **Pricing**, **App Privacy**, and **Mac App Store** listing metadata (screenshots, description, category: Board Games).
4. **GPL / open source (required):** Because the app bundles GPL v3 Fairy-Stockfish, provide source to users:
   - Public repo: https://github.com/sahasrarjn/chess-app
   - Add the source URL in the App Store description and/or support URL
   - Include GPL license text in the app (Settings/About) or link to `LICENSE` in the repo
   - Note: Apple’s store DRM vs GPL is debated; many GPL apps ship on the Mac App Store with a prominent source link. Direct download (`release-mac.sh`) avoids that debate.

### 2. Certificates and provisioning (Apple Developer)

In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources):

1. **Identifier:** `com.sahasraranjan.chessborder.mac`
   - Enable **App Sandbox** (required for Mac App Store)
   - No extra capabilities needed for v1
2. **Certificate:** create **Apple Distribution** (Mac App Store and TestFlight) if you do not already have one.
3. **Provisioning profile:** Xcode automatic signing usually creates a **Mac App Store** profile when you archive with the App Store entitlements file.

App Store builds use `ChessBorder/ChessBorderAppStore.entitlements` (App Sandbox + engine JIT entitlements). Developer ID builds keep using `ChessBorder.entitlements` via `release-mac.sh`.

### 3. Bump version and build number

Edit `ChessBorder/project.yml`:

```yaml
MARKETING_VERSION: "1.0.1"   # user-visible version
CURRENT_PROJECT_VERSION: "2" # must increase every upload
```

Regenerate the Xcode project if you use XcodeGen:

```bash
cd ChessBorder && xcodegen generate
```

### 4. Build Fairy-Stockfish (Mac engine binary)

```bash
./ChessBorder/scripts/setup-engine.sh
```

### 5. Archive and export (command line)

```bash
cd ChessBorder
./scripts/release-appstore-mac.sh
```

This:

1. Archives `ChessBorderMac` (Release, generic macOS)
2. Signs with **Apple Distribution** / Mac App Store profile (automatic)
3. Exports a signed `.pkg` to `ChessBorder/build/appstore-mac/`

Output paths:

- Archive: `ChessBorder/build/ChessBorderMac.xcarchive`
- Package: `ChessBorder/build/appstore-mac/*.pkg`

### 5b. Archive in Xcode (alternative)

1. Open `ChessBorder/ChessBorder.xcodeproj`
2. Scheme: **ChessBorderMac**
3. Destination: **Any Mac (Apple Silicon)** or **Any Mac**
4. **Product → Archive**
5. Organizer → **Distribute App** → **App Store Connect** → Upload

For Xcode archive, set **Signing & Capabilities → Code Signing Entitlements** to `ChessBorderAppStore.entitlements` on the ChessBorderMac target (Release), or run the script which passes entitlements on the command line.

### 6. Upload to App Store Connect

**Option A — script (API key, good for automation):**

Add to repo `.env`:

```bash
APP_STORE_CONNECT_KEY_ID=XXXXXXXXXX
APP_STORE_CONNECT_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
APP_STORE_CONNECT_API_KEY_PATH=$HOME/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8
```

Create the API key in App Store Connect → **Users and Access → Integrations → App Store Connect API**. Store the `.p8` file at the path above (or under `~/private_keys/`).

```bash
cd ChessBorder
./scripts/release-appstore-mac.sh --upload
```

**Option B — Transporter (manual):**

1. Open **Transporter.app** (Mac App Store)
2. Drag `ChessBorder/build/appstore-mac/*.pkg`
3. Deliver

**Option C — Xcode Organizer:** Distribute App → Upload from the archive created in step 5b.

### 7. TestFlight (optional)

1. App Store Connect → your app → **TestFlight**
2. Wait for processing (often 5–30 minutes)
3. Add internal testers (team) or external testers (requires brief Beta App Review)
4. Install on Mac via TestFlight app or invitation link

### 8. App Store release

1. App Store Connect → **App Store** tab → create a version matching `MARKETING_VERSION`
2. Select the uploaded build
3. Complete review information (export compliance, content rights, etc.)
4. **Submit for Review**
5. After approval, release manually or automatically

**Updates:** bump `CURRENT_PROJECT_VERSION`, run `release-appstore-mac.sh --upload` again. Existing users receive updates through the Mac App Store (System Settings → General → Software Update, or the App Store app).

### 9. What stays unchanged

- `release-mac.sh` — still builds Developer ID DMG for direct download + notarization
- `release-ios.sh` / `publish-release.sh` — still handle iPhone OTA distribution
- No Sparkle or custom OTA updater for Mac App Store builds

---

## Developer ID macOS (direct download)

For notarized DMG outside the App Store:

```bash
cd ChessBorder
./scripts/release-mac.sh
```

Requires `DEVELOPER_ID` in `.env`. See root [README.md](../../README.md).

## iOS OTA

```bash
cd ChessBorder
./scripts/release-ios.sh
./scripts/publish-release.sh
```
