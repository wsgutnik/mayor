# Signing and Notarizing Mayor (Mac) and Signing for iPad

State (2026-10-15): the Mac releases `v0.1.0-m34` and `v0.1.0-m35` ship `Mayor-mNN-mac-arm64-signed-notarized.dmg`,
signed with `Developer ID Application: Willian Gutnik (4AFHZKZYQ6)`, notarized and stapled, built with
`npm run release:mac` (`scripts/release-mac.sh`, see "One-command release" below). Ad hoc signing
(`npm run package:adhoc`) remains the fallback when no identity is available.

| Artifact | Bundle id | Certificate | Profile | Distribution |
|---|---|---|---|---|
| Mac app (dmg) | `com.mayor.game` | Developer ID Application | none (notarized) | GitHub release, `gh release create` |
| iPad app (IPA) | `com.gutnik.mayor` (`src-tauri/tauri.ios.conf.json`) | Apple Distribution | "Mayor App Store" | App Store Connect (TestFlight, App Store) |
| iPad development installs | `com.gutnik.mayor` | Apple Development | Xcode-managed development profile | `xcrun devicectl` / Xcode |

iPad signing, build numbers and upload are documented in [docs/IOS.md](IOS.md); the store runbook is
[docs/appstore/APPSTORE.md](appstore/APPSTORE.md). Every password (notarization, altool upload) is an app-specific
password typed by the owner at a hidden prompt or stored in the keychain; none is in git or in these docs.

The rest of this page is the Mac procedure. Without a Developer ID identity the app is signed **ad hoc**: it opens on
the Mac that generated it, but on other Macs Gatekeeper asks the user to "Open Anyway".

## What Is Needed (Once)

1. An **Apple Developer Program** account (US$99/year), at https://developer.apple.com/programs/.
2. In Xcode (Settings > Accounts > Manage Certificates) or in the portal, create the **Developer ID Application** certificate.
   It appears in Keychain Access (login). Check with:
   ```bash
   security find-identity -v -p codesigning
   ```
   The line looks like `"Developer ID Application: Your Name (TEAMID1234)"`.
3. Store notarization credentials in the keychain (the password is an *app-specific password* from
   https://account.apple.com > Security):
   ```bash
   xcrun notarytool store-credentials mayor-notary \
     --apple-id you@example.com --team-id TEAMID1234 --password <app-specific-password>
   ```
   None of this goes into git: the password stays only in the keychain.

## Shortcut with the Certificate Script (Done Locally)

```bash
scripts/mac-cert-setup.sh csr "Your Name" you@example.com   # generates the private key and CSR in ~/.mayor-signing
# upload ~/.mayor-signing/mayor.csr at developer.apple.com > Certificates > + > Developer ID Application
scripts/mac-cert-setup.sh import ~/Downloads/developerID_application.cer   # joins key and certificate and installs them in the keychain
scripts/mac-cert-setup.sh notary TEAMID1234 you@example.com                 # asks for the app-specific password and stores it in the keychain
```

Only the Account Holder can create the Developer ID certificate. The key stays in `~/.mayor-signing` (mode 700), outside the repository.

## Build the Signed and Notarized Package

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID1234)"
npm run package:signed
```

The script (`scripts/sign-mac.sh`) runs `npm run ci`, builds with the hardened runtime and `entitlements.plist`, submits the dmg to Apple (`notarytool submit --wait`), staples the ticket (`stapler staple`), and verifies with `codesign` and `spctl`.

Verify at any time with: `npm run verify:mac`. Expected after notarization:
`spctl --assess` with `accepted source=Notarized Developer ID` and `stapler validate` with `The validate action worked!`.

## Without a Paid Account (Fallback)

`npm run package:adhoc` creates the app with consistent ad hoc signing (identifier `com.mayor.game`, hardened runtime,
sealed resources). It does not remove the Gatekeeper warning on other Macs. To open:

- right-click the app > **Open** > **Open**, or
- System Settings > Privacy & Security > **Open Anyway**, or
- `xattr -dr com.apple.quarantine /Applications/Mayor.app` (removes quarantine from the downloaded file).

## Publish the dmg

After notarization:
```bash
gh release create vX.Y.Z src-tauri/target/release/bundle/dmg/Mayor_*.dmg --repo wsgutnik/mayor --prerelease
```
(Always from the local package; no GitHub Actions.)

## If the Notarized App Does Not Open

The hardened runtime blocks JIT and unsigned memory in the app process. The web view (WKWebView) runs in Apple's process,
so normally nothing else is needed. If the log shows a block, add the required key to `src-tauri/entitlements.plist` and note the reason next to it.

## One-command release (certificate installed)

With the Developer ID Application certificate in the login keychain (done: `Developer ID Application: Willian Gutnik
(4AFHZKZYQ6)`), run:

```bash
npm run release:mac
```

The first run asks for the Apple ID and an app-specific password (hidden prompt; create it at account.apple.com →
Sign-In and Security → App-Specific Passwords) and stores them in the keychain profile `mayor-notary`. The script
builds, signs with the hardened runtime, builds the dmg (falling back to `hdiutil` when the Tauri dmg step fails),
signs the dmg, notarizes, staples and verifies, and copies the result to `release-out/`. The password is never written
to disk or to the command line.

The script writes `release-out/Mayor-signed-<version>-mac-arm64.dmg` and appends to `release-out/SHA256SUMS`. For
the M34/M35 releases the files were renamed by hand to `Mayor-mNN-mac-arm64-signed-notarized.dmg`, with
`Mayor-mNN-ipad-pwa.zip` (zip of `dist/`) and `SHA256SUMS-mNN`, then published:

```bash
gh release create v0.1.0-mNN <dmg> <pwa.zip> <SHA256SUMS-mNN> --repo wsgutnik/mayor --prerelease
```
