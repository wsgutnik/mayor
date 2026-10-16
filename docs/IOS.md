# Native iPad Build

Mayor ships on iPad as a Tauri 2 app (the game runs in WKWebView, fully offline). This page covers the toolchain,
development installs and the signed App Store / TestFlight build. The store listing, review and submission steps are
in [docs/appstore/APPSTORE.md](appstore/APPSTORE.md). No credentials are stored in git or in these docs.

## Current Configuration

| Item | Value |
|---|---|
| Bundle id (iOS) | `com.gutnik.mayor`, set in `src-tauri/tauri.ios.conf.json` (merged over `tauri.conf.json` for iOS builds). `com.mayor.game` is registered to another developer team and cannot be used on iOS. The Mac app keeps `com.mayor.game`. |
| Build number | `bundle.iOS.bundleVersion` in `src-tauri/tauri.ios.conf.json` (currently `"5"`). Raise it for every upload. |
| Marketing version | `version` in `src-tauri/tauri.conf.json` = `package.json` `version` (`0.1.0`) |
| Team | `4AFHZKZYQ6` (automatic signing in the Xcode project) |
| Device family | iPad only (`TARGETED_DEVICE_FAMILY = 2` in `src-tauri/gen/apple/project.yml` and `project.pbxproj`) |
| Minimum iOS | 15.0 |
| Orientation | landscape left/right; `UIRequiresFullScreen` (deprecated in iPadOS 26 but still accepted) |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` |
| Icon | full-bleed opaque MAYOR logo in `src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/` (copy: `docs/appstore/icon-1024.png`) |
| Xcode project | generated and committed under `src-tauri/gen/apple/` (`eff021b`); scheme `app_iOS` |
| App Store Connect app | Apple ID `6823091760`, name "Mayor: Construtor de Cidades" (pt-BR primary) |

## Toolchain (one time)

1. Xcode 26 with the iOS 26 SDK (App Store Connect requires it since April 2026). Xcode 26.6 (SDK 26.5) is installed
   and produced builds 1 to 4; the earlier "stay on 26.1.1" advice is obsolete.
   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   xcodebuild -runFirstLaunch
   ```
2. Rust targets: `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`
3. Generators: `sudo gem install cocoapods` and `brew install xcodegen`
4. Check: `bash scripts/ios-prereq-check.sh` (toolchain) and `bash scripts/appstore-prereq-check.sh` (store
   readiness; see the caveats in [STATUS-2026-10-15.md](STATUS-2026-10-15.md)).

Signing assets (in the login keychain / Xcode, never in git): an Apple Development certificate for device installs, an
**Apple Distribution** certificate for App Store builds, and the App Store provisioning profile **"Mayor App Store"**
for `com.gutnik.mayor`. The App ID `com.gutnik.mayor` ("Mayor") was registered on 2026-10-15.

## Simulator and development installs

```bash
npm run ios:dev        # prereq check + tauri ios dev (simulator or a connected device)
```

Direct install of a built development app on a cabled or paired iPad with `devicectl` (Xcode 15+):

```bash
xcrun devicectl list devices
xcrun devicectl device install app --device <DEVICE_ID> <path/to/Mayor.app>
xcrun devicectl device process launch --device <DEVICE_ID> com.gutnik.mayor
```

The development installs made on 2026-10-15 before the bundle id change used `com.mayor.game`; delete that copy
from the iPad to avoid two "Mayor" icons. Simulator captures: `xcrun simctl io booted screenshot file.png`.

## App Store / TestFlight build

1. Raise the build number in `src-tauri/tauri.ios.conf.json` (`"bundleVersion": "6"` for the next upload).
   Do not use `--build-number N`: Tauri appends it to the version (`0.1.0.N`), which App Store Connect rejects.
2. Build and export the signed IPA (Apple Distribution identity, "Mayor App Store" profile):
   ```bash
   npm run ci
   npm run ios:build -- --export-method app-store-connect
   ```
   Output: archive `src-tauri/gen/apple/build/app_iOS.xcarchive`, IPA `src-tauri/gen/apple/build/arm64/Mayor.ipa`.
3. Confirm what went in:
   ```bash
   /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' -c 'Print :CFBundleShortVersionString' \
     -c 'Print :CFBundleVersion' \
     src-tauri/gen/apple/build/app_iOS.xcarchive/Products/Applications/Mayor.app/Info.plist
   ```
4. Upload with `altool` and an app-specific password that the owner types at a hidden prompt (zsh form; the
   password never lands in the shell history or a file; it is visible in the process list while altool runs; with
   `export APP_PW` you can pass `-p @env:APP_PW` instead to avoid that):
   ```zsh
   read -s "APP_PW?App-specific password: "; echo
   xcrun altool --upload-app -f src-tauri/gen/apple/build/arm64/Mayor.ipa -t ios \
     -u <APPLE_ID_EMAIL> -p "$APP_PW"
   unset APP_PW
   ```
   Create the app-specific password at account.apple.com > Sign-In and Security > App-Specific Passwords.
   Alternatives: Xcode Organizer > Distribute App > App Store Connect, or the Transporter app.
5. Processing takes 5 to 30 minutes; the build then appears in App Store Connect > TestFlight. The internal group
   **"Equipe"** receives it without Beta App Review.

### Builds so far

| Build | Date | Contents | Where |
|---|---|---|---|
| 1 | 2026-10-15 | 0.1.0, old icon, iPhone + iPad family | TestFlight (superseded) |
| 2 | 2026-10-15 | iPad only, MAYOR logo icon (`3028c3e`) | TestFlight (superseded) |
| 3 | 2026-10-15 | App Store package, About and credits (`1b3408c`) | **Submitted for review 2026-10-15 03:05 PDT, Waiting for Review** |
| 4 | 2026-10-15 | Tool state reducer and menu rework (`db6c2d9`, `6c0ec5a`) | TestFlight only (not submitted) |
| 5 | 2026-10-15 | Roads 1A+1B (`d3232c3`) | TestFlight only (not submitted) |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Xcode: not installed` | Only Command Line Tools are selected. | Install Xcode 26 and run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`. |
| `missing: iPhoneOS SDK` | iOS platform support is not installed. | Open Xcode once and install iOS platform support. |
| Rust target missing | iOS std libraries are not installed. | `rustup target add aarch64-apple-ios aarch64-apple-ios-sim` |
| "No profiles for com.gutnik.mayor were found" | Distribution profile missing. | Sign in to Xcode (Settings > Accounts) or install the "Mayor App Store" profile, then rerun. |
| App ID already taken | `com.mayor.game` belongs to another team. | Keep `com.gutnik.mayor` in `tauri.ios.conf.json`. |
| Upload rejected: build number already used | `bundleVersion` not raised. | Increase it in `tauri.ios.conf.json` and rebuild. |
| Upload rejected: four-part `CFBundleVersion` | `--build-number` was used. | Remove the flag; set `bundleVersion` instead. |
| Black or unstable WebGL view | Device GPU/texture limits. | In-game graphics quality menu; shadows are capped on iOS. Real-iPad performance is not measured yet. |

## Known toolchain pin

`libc` is pinned to 0.2.189 in `src-tauri/Cargo.lock`. libc 0.2.190 made `mach_task_self` macOS-only, which breaks
`num_threads 0.1.7` (a dependency of `time`) when building for `aarch64-apple-ios`. Remove the pin once `time`/`num_threads`
no longer depend on it (`cargo update -p libc` then rebuild for iOS to check).

## Uploading without a password prompt (used for build 5, 2026-10-16)

With the Xcode account signed in, the archive built by `npm run ios:build` can be uploaded straight to App Store
Connect, no app-specific password: `xcodebuild -exportArchive -archivePath src-tauri/gen/apple/build/app_iOS.xcarchive
-exportOptionsPlist <plist> -exportPath <dir>` where the plist has `method app-store-connect`, `destination upload`,
`teamID 4AFHZKZYQ6`, manual signing with the "Apple Distribution" certificate and the "Mayor App Store" profile for
`com.gutnik.mayor`. Build 5 (0.1.0, Roads 1A+1B) was uploaded this way and is TestFlight only (not submitted for review).
