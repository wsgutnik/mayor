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
| `screenshots/` | 5 + 5 iPad 13-inch landscape screenshots (2752x2064), English and Portuguese. **Local only**: the `.gitignore` pattern `screenshots/` (meant for the third-party reference folder) also excludes this folder, so it exists in the owner's main checkout but not in git or in worktrees. The prereq script reports "Screenshots count=0" outside the main checkout. |
| `icon-1024.png` | The App Store icon (same file as in the Xcode asset catalog) |
| `../../scripts/appstore-prereq-check.sh` | Local pass/fail table: Xcode, bundle id, versions, Info.plist keys, icons, privacy greps, metadata limits, screenshots |

## Status (2026-10-15)

| Step | State |
|---|---|
| Program license, Free Apps agreement | Accepted. Paid Apps agreement **not** signed (not needed: the app is free, no in-app purchases). |
| App ID `com.gutnik.mayor` ("Mayor") | Registered 2026-10-15. `com.mayor.game` belongs to another team, so iOS uses `com.gutnik.mayor` (`src-tauri/tauri.ios.conf.json`). |
| Apple Distribution certificate | Installed in the login keychain. |
| App Store provisioning profile | "Mayor App Store" (manual, App Store Connect distribution, `com.gutnik.mayor`). |
| App Store Connect record | App Apple ID `6823091760`, "Mayor: Construtor de Cidades", primary language Portuguese (Brazil), English (U.S.) localization added. |
| Builds uploaded | 1, 2, 3, 4 (see the table in `docs/IOS.md`). Upload with `xcrun altool` and an app-specific password typed by the owner. |
| TestFlight | Internal group "Equipe". |
| Listing | pt-BR and en-US texts from the metadata files, 5 screenshots per language at 2752x2064, category Games > Simulation (secondary Strategy). |
| URLs entered | Privacy policy `https://mayor-demo.vercel.app/privacidade`, support `https://mayor-demo.vercel.app/suporte` (English pages `/privacy` and `/support` also exist), marketing URL `https://github.com/wsgutnik/mayor` (public repo). |
| Age rating | 4+ (all questionnaire answers "None"). |
| App Privacy | Data Not Collected. |
| Content rights | "Contains third-party content and I have the rights to use it" (CC0 assets, MIT code, credited in About and credits). |
| DSA (EU) trader status | Declared **non-trader**. |
| Pricing and availability | Free, all 175 regions. |
| Version release | Manual ("liberação manual"): the owner releases after approval. |
| Submission | **Build 3 submitted 2026-10-15 03:05 PDT; Waiting for Review.** Build 4 is in TestFlight only. |

Open before or after review: Export save on iPad untested (risk 4 in `review-notes.md`); real-iPad performance not
measured; `UIRequiresFullScreen` deprecated in iPadOS 26; Apple may request a privacy manifest; App Review contact
details are entered in App Store Connect only. Full list: `docs/STATUS-2026-10-15.md`.

## 0. Check the project locally

```bash
npm install
npm run ci                                # types, tests, web build (must be green)
bash scripts/appstore-prereq-check.sh     # must end with "0 fail"
```

Known false failures as of `6c0ec5a` (script bugs, not store problems): "Bundle id (tauri.conf)" and "Build number"
read `src-tauri/tauri.conf.json`, but the iOS bundle id and `bundleVersion` moved to `src-tauri/tauri.ios.conf.json`
in `7daa467`; "Icons opaque" flags `src-tauri/icons/ios/AppIcon-512@2x.png`, which is still RGBA in git (the Xcode
asset catalog that the build actually uses is opaque RGB); "Screenshots count=0" outside the main checkout (see the
table above). The script needs a fix before "0 fail" is a meaningful gate.

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
7. Host the **privacy policy** and **support** pages (text in `privacy.md`). Done: `/privacidade`,
   `/privacy`, `/suporte`, `/support` on `mayor-demo.vercel.app` (site source and deploy: `docs/WEB-DEMO.md`).

## 2. Version and build number

- Marketing version (`CFBundleShortVersionString`): `version` in `src-tauri/tauri.conf.json`
  (currently `0.1.0`). Keep `package.json` `version` equal; the About screen shows it. For the store
  launch consider `1.0.0` (edit both files).
- Build number (`CFBundleVersion`): `bundle.iOS.bundleVersion` in `src-tauri/tauri.ios.conf.json`
  (currently `"4"`; the next upload is `"5"`). It must increase for **every** upload of the same marketing version.
  Edit the file and commit it with the build (as in `6c0ec5a`), or override per build without editing:
  ```bash
  npm run ios:build -- --export-method app-store-connect -c '{"bundle":{"iOS":{"bundleVersion":"5"}}}'
  ```
  Avoid `--build-number N`: Tauri appends it to the version (`0.1.0.N`), a four-part
  `CFBundleVersion` that App Store Connect rejects.
- After a build, confirm what went in:
  ```bash
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' -c 'Print :CFBundleVersion' \
    src-tauri/gen/apple/build/app_iOS.xcarchive/Products/Applications/Mayor.app/Info.plist
  ```

## 3. Build the signed archive and IPA locally (OWNER runs; needs the signing identity)

Toolchain: Xcode 26 (26.6 is installed and produced builds 1 to 4), iOS 26 SDK (required by App Store Connect
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

What was used for builds 1 to 4: `altool` with the Apple ID and an app-specific password typed at a hidden zsh
prompt (never stored in a file or the shell history; `-p @env:APP_PW` after `export APP_PW` also keeps it out of
the process list):

```zsh
read -s "APP_PW?App-specific password: "; echo
xcrun altool --upload-app -f src-tauri/gen/apple/build/arm64/Mayor.ipa -t ios -u <APPLE_ID_EMAIL> -p "$APP_PW"
unset APP_PW
```

Alternatives:
- Organizer > Distribute App > App Store Connect > Upload.
- **Transporter** app (Mac App Store): drag `Mayor.ipa`, Deliver.
- Terminal with an API key instead of a password: `xcrun altool --upload-app -f src-tauri/gen/apple/build/arm64/Mayor.ipa -t ios --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>`.

Processing takes 5 to 30 minutes; App Store Connect emails if the build has problems (icons,
Info.plist keys, privacy manifest). Export compliance is answered by
`ITSAppUsesNonExemptEncryption = false`, so the build should not wait on that question.

## 6. TestFlight internal test (OWNER)

1. App Store Connect > Mayor > TestFlight > the build appears under iOS builds.
2. Internal Testing > group **"Equipe"** (created 2026-10-15) > add testers (internal testers need no Beta App Review).
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
   Done: Free, 175 regions. EU Digital Services Act: trader status declared "non-trader".
5. App Review Information: contact details, sign-in not required, paste the Notes block from
   `review-notes.md`.
6. Version release: manual or automatic after approval. Done: manual release.
7. **Add for Review** > **Submit**. Typical review time is 1 to 3 days. If rejected, the most likely
   items and answers are in `review-notes.md` §2.

## 8. Later updates

Raise `bundle.iOS.bundleVersion` for every upload, raise `version` for every public release, update
What's New in both metadata files, rerun `npm run ci` and `bash scripts/appstore-prereq-check.sh`,
then repeat steps 3 to 7.
