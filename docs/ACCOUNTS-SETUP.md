# Accounts Console Setup Checklist

These steps require manual action in external developer consoles and cannot be
automated. Complete them before running `./server/aws/deploy-accounts.sh`.

---

## Google Cloud

> **Do NOT reuse the personal-brain OAuth client** — its consent screen shows
> Brain branding. Create a fresh GCP project for Border Chess.

1. Create a new GCP project (e.g. `border-chess`) at
   [console.cloud.google.com](https://console.cloud.google.com).

2. **APIs & Services → OAuth consent screen:**
   - User type: External
   - App name: `Border Chess`
   - Support email: your email
   - Publish (or add test users while testing)

3. **Credentials → Create Credentials → OAuth client ID → Web application:**
   - Authorized JavaScript origins:
     - `https://borderchess.org`
     - `http://localhost:5173`
   - No redirect URIs needed (GIS ID-token popup flow).
   - Copy the **web client ID** →
     - `VITE_GOOGLE_CLIENT_ID` in web build env
     - First entry of `GOOGLE_CLIENT_IDS` in `deploy-accounts.sh`

4. **Credentials → Create Credentials → OAuth client ID → iOS:**
   - Bundle ID: `com.sahasraranjan.chessborder`
   - Copy the **iOS client ID** →
     - `GoogleClientID` in `project.yml`
     - Second entry of `GOOGLE_CLIENT_IDS` in `deploy-accounts.sh`
     - Reversed form (`com.googleusercontent.apps.<id>`) → `CFBundleURLSchemes`
       placeholder in `project.yml`

---

## Apple Developer Portal (team LG3L588JT3)

1. Go to [developer.apple.com](https://developer.apple.com) →
   Certificates, Identifiers & Profiles → Identifiers →
   `com.sahasraranjan.chessborder` → check **Sign In with Apple**
   (Enable as primary App ID) → Save.

2. Xcode automatic signing regenerates the provisioning profile on next build;
   no certificate work needed.

3. **(Deferred)** Web Apple sign-in later needs a **Services ID** + verified
   domain `borderchess.org` + return URL — out of scope for this release; the
   web stub stays hidden until `VITE_APPLE_CLIENT_ID` is set.

---

## After Console Setup

Run the deploy:

```bash
AWS_PROFILE=sahasralabs \
GOOGLE_CLIENT_IDS="<web-id>.apps.googleusercontent.com,<ios-id>.apps.googleusercontent.com" \
APPLE_CLIENT_IDS="com.sahasraranjan.chessborder" \
./server/aws/deploy-accounts.sh
```

Verify the accounts API is live:

```bash
curl -s -o /dev/null -w '%{http_code}' "$API_URL/v1/me"  # → 401
```

Then:
- Set `VITE_ACCOUNTS_API_URL` + `VITE_GOOGLE_CLIENT_ID` in the web build env
  and run `./web/scripts/sync-s3-static.sh`.
- Fill `AccountsServerURL` / `GoogleClientID` / URL scheme in `project.yml`,
  then run `xcodegen generate` (see Task 13 Step 5 gotchas: scheme
  BuildableName, version-key drift).
- Bump the app version in `project.yml` when shipping.
- Run `ACCOUNTS_API_URL=<url> ./scripts/verify-site.sh` to confirm the smoke
  check passes.
