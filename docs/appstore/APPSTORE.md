# Mayor on the App Store (iPad): owner runbook

Everything that can be prepared locally is in this folder. The steps marked **OWNER** need your
Apple account, agreements or credentials and are never done by agents. Builds and uploads are
**local only**: no GitHub Actions, no CI service (AGENTS.md rules 8 and 9; same policy as the Mac
releases).

| File | Use |
|---|---|
| `metadata.pt-BR.md`, `metadata.en.md` | Name, subtitle, promotional text, description, keywords, URLs, copyright, category, age rating answers, What's New |
| `privacy.md` | App Privacy label answers, network/analytics audit, privacy policy text (pt-BR + en), export compliance |
| `review-notes.md` | Notes for App Review and the rejection-risk table |
| `assets.md` | Icon and screenshot checklist (Apple sizes) and how screenshots were made |
| `screenshots/` | 5 + 5 iPad 13-inch landscape screenshots (2752x2064), English and Portuguese |
| `icon-1024.png` | The App Store icon (same file as in the Xcode asset catalog) |
| `../../scripts/appstore-prereq-check.sh` | Local pass/fail table: Xcode, bundle id, versions, Info.plist keys, icons, privacy greps, metadata limits, screenshots |

## 0. Check the project locally

```bash
npm install
npm run ci                                # types, tests, web build (must be green)
bash scripts/appstore-prereq-check.sh     # must end with "0 fail"
```

What was fixed for the store in this pass: iOS app icon (it was the default Tauri logo), iPad-only
device family, landscape-only orientations kept consistent in `project.yml`, build number
(`bundle.iOS.bundleVersion`), in-app "About and credits" screen (licences, privacy line), export
compliance key in `project.yml`.

## 1. Prerequisites (OWNER, one time)

1. **Apple Developer Program**: membership active on team `4AFHZKZYQ6`; accept the latest
   **Program License Agreement** in developer.apple.com > Account (uploads fail while an agreement
   is pending).
2. **Paid Apps agreement**: only if Mayor will be paid or ever have in-app purchases. App Store
   Connect > Business: accept the Paid Apps agreement and fill in bank and tax forms. A free app
   needs only the Free Apps agreement (accepted with the program).
3. **App ID**: Certificates, Identifiers & Profiles > Identifiers > `+` > App IDs > App > Bundle ID
   explicit `com.gutnik.mayor`, description "Mayor". No capabilities are needed (no Game Center, iCloud,
   push or purchases today).
4. **Distribution certificate**: an "Apple Distribution" certificate in your login keychain.
   Easiest: Xcode > Settings > Accounts > your Apple ID > team `4AFHZKZYQ6` > Manage Certificates >
   `+` > Apple Distribution. (Never commit certificates, `.p12` files or passwords.)
5. **App Store provisioning profile**: either let Xcode manage signing automatically (the project
   uses automatic signing with team `4AFHZKZYQ6`; Xcode creates "iOS Team Store Provisioning Profile:
   com.gutnik.mayor" during distribution), or create one manually: Profiles > `+` > Distribution >
   App Store Connect > App ID `com.gutnik.mayor` > your Apple Distribution certificate, download and
   double-click it.
6. **App Store Connect app record**: appstoreconnect.apple.com > Apps > `+` > New App:
   - Platform: iOS
   - Name: `Mayor: Construtor de Cidades` (pt-BR primary; the English localization uses
     `Mayor: City Builder`). Names are unique across the store; if taken, try `Mayor - City Builder`
     or `Mayor: Cidades`, and update the metadata files.
   - Primary language: **Portuguese (Brazil)**; then add the **English (U.S.)** localization.
   - Bundle ID: `com.gutnik.mayor`
   - SKU: `MAYOR-IPAD-001` (any unique internal string)
   - User access: Full access
7. Host the **privacy policy** and **support** pages (text in `privacy.md`; URLs in the metadata
   files are placeholders on `mayor-demo.vercel.app`). Replace `github.com/wsgutnik/mayor/issues` first.

## 2. Version and build number

- Marketing version (`CFBundleShortVersionString`): `version` in `src-tauri/tauri.conf.json`
  (currently `0.1.0`). Keep `package.json` `version` equal; the About screen shows it. For the store
  launch consider `1.0.0` (edit both files).
- Build number (`CFBundleVersion`): `bundle.iOS.bundleVersion` in `src-tauri/tauri.conf.json`
  (currently `"1"`). It must increase for **every** upload of the same marketing version (1, 2, 3...).
  Either edit the file, or override per build without editing:
  ```bash
  npm run ios:build -- --export-method app-store-connect -c '{"bundle":{"iOS":{"bundleVersion":"2"}}}'
  ```
  Avoid `--build-number N`: Tauri appends it to the version (`0.1.0.N`), a four-part
  `CFBundleVersion` that App Store Connect rejects.
- After a build, confirm what went in:
  ```bash
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' -c 'Print :CFBundleVersion' \
    src-tauri/gen/apple/build/app_iOS.xcarchive/Products/Applications/Mayor.app/Info.plist
  ```

## 3. Build the signed archive and IPA locally (OWNER runs; needs the signing identity)

Toolchain: Xcode 26 (26.6 is installed and produced the earlier development IPA; the old
"stay on 26.1.1" note in `docs/IOS.md` predates that), iOS 26 SDK (required by App Store Connect
since April 2026), Rust target `aarch64-apple-ios`, CocoaPods, XcodeGen (`bash scripts/ios-prereq-check.sh`).

Option A, Tauri CLI (recommended, one command):

```bash
npm run ci
npm run ios:build -- --export-method app-store-connect
# runs scripts/ios-prereq-check.sh, then: tauri ios build --export-method app-store-connect
```

- Builds the web bundle (`npm run build`), the Rust static library for `aarch64-apple-ios`, archives
  the Xcode project and exports with method `app-store-connect`.
- Outputs: archive `src-tauri/gen/apple/build/app_iOS.xcarchive`, IPA
  `src-tauri/gen/apple/build/arm64/Mayor.ipa`.
- `src-tauri/gen/apple/ExportOptions.plist` says `debugging` in git; Tauri rewrites the export
  options for the method you pass. Do not hand-edit it for the store build.
- If signing fails with "No profiles for com.gutnik.mayor were found", open Xcode once with your Apple
  ID signed in (Settings > Accounts) so automatic signing can create the distribution profile, or
  install the manual profile from step 1.5, then rerun.

Option B, Xcode (same result, GUI signing):

```bash
npm run build                      # web bundle into dist/
open src-tauri/gen/apple/app.xcodeproj
```

Scheme `app_iOS`, destination "Any iOS Device (arm64)", Product > Archive. The archive appears in
Window > Organizer.

Never upload an IPA built before this change set is merged (for example the development IPA from
2026-10-15 01:13 in the main checkout): earlier builds carry the default Tauri icon and the iPhone
device family.

## 4. Validate (OWNER)

Organizer > select the archive > **Validate App** (uses your Xcode account), or from the terminal
with an App Store Connect API key you create in App Store Connect > Users and Access > Integrations
(the `.p8` file lives in `~/.appstoreconnect/private_keys/`, never in the repository):

```bash
xcrun altool --validate-app -f src-tauri/gen/apple/build/arm64/Mayor.ipa -t ios \
  --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>
```

Also run Organizer > right-click the archive > **Generate Privacy Report**; if it lists
required-reason APIs from the binary, add a `PrivacyInfo.xcprivacy` as described in `privacy.md` §2.5.

## 5. Upload (OWNER)

Any one of:
- Organizer > Distribute App > App Store Connect > Upload (simplest; uses automatic signing).
- **Transporter** app (Mac App Store): drag `Mayor.ipa`, Deliver.
- Terminal: `xcrun altool --upload-app -f src-tauri/gen/apple/build/arm64/Mayor.ipa -t ios --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>`.

Processing takes 5 to 30 minutes; App Store Connect emails if the build has problems (icons,
Info.plist keys, privacy manifest). Export compliance is answered by
`ITSAppUsesNonExemptEncryption = false`, so the build should not wait on that question.

## 6. TestFlight internal test (OWNER)

1. App Store Connect > Mayor > TestFlight > the build appears under iOS builds.
2. Internal Testing > `+` group "Owner" > add yourself (internal testers need no Beta App Review).
3. Install TestFlight on the iPad, accept, play. Checklist before submitting:
   - First launch in pt-BR and in English (device language), guide card, draw road, zone, power,
     water, 2x speed, buildings appear.
   - Menu > About and credits opens and returns; licences readable.
   - Save to slot, force-quit, reopen, Continue; autosave after a month.
   - **Menu > Save file > Export and Import** (risk 4 in `review-notes.md`: hide Export on iOS if
     it does nothing).
   - Both landscape orientations; iPad mini and an 11-inch if available; 15 minutes with a big city
     at High quality without a crash or a black view.
   - Airplane Mode: everything still works.

## 7. Store listing and submission (OWNER)

1. App Store Connect > Mayor > App Store tab > version 1.0 (or 0.1.0):
   - Paste pt-BR texts from `metadata.pt-BR.md`; switch the localization to English (U.S.) and
     paste `metadata.en.md`.
   - Screenshots: iPad 13-inch display: drag `screenshots/ipad13-pt-*.jpg` into pt-BR and
     `screenshots/ipad13-en-*.jpg` into English, in file order.
   - Build: choose the uploaded build.
   - Copyright, support URL, marketing URL from the metadata files.
2. App Information: category Games > Simulation, secondary Games > Strategy; privacy policy URL;
   age rating questionnaire (answers in `metadata.en.md`, result 4+); Content Rights: answer that
   the app **contains third-party content and you have the rights to use it** (CC0 assets and
   MIT-licensed code, all credited in Menu > About and credits).
3. App Privacy: "Data Not Collected" (`privacy.md` §2).
4. Pricing and Availability: price (Free or a tier; paid needs the Paid Apps agreement), countries.
5. App Review Information: contact details, sign-in not required, paste the Notes block from
   `review-notes.md`.
6. Version release: manual or automatic after approval.
7. **Add for Review** > **Submit**. Typical review time is 1 to 3 days. If rejected, the most likely
   items and answers are in `review-notes.md` §2.

## 8. Later updates

Raise `bundle.iOS.bundleVersion` for every upload, raise `version` for every public release, update
What's New in both metadata files, rerun `npm run ci` and `bash scripts/appstore-prereq-check.sh`,
then repeat steps 3 to 7.
