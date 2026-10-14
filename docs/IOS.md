# Native iOS Build

Mayor can be prepared for iPad/iPhone with Tauri 2, but `tauri ios init`, Xcode project generation, simulator/device runs, signing, archive export, and TestFlight upload require full Xcode. Command Line Tools alone are not enough.

## Current Configuration

- Bundle identifier: `com.mayor.game`, matching the Mac app.
- Apple Developer team: `4AFHZKZYQ6`.
- Minimum iOS version: `15.0`.
- Orientation: landscape left/right only for iPhone and iPad.
- iPad mode: fullscreen, no Split View, hidden status bar.
- Rust mobile entry point and crate types are enabled in `src-tauri`.
- iOS AppIcon PNGs live in `src-tauri/icons/ios/`, generated from `public/icons/icon-1024.png`.

## One-Time Setup

1. Install Xcode 26.1.1 from https://developer.apple.com/download/all. Do not use Xcode 26.4+ for this project until the toolchain is verified with it.
2. Select Xcode and install platform support:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   xcodebuild -runFirstLaunch
   ```
3. Add the Rust targets:
   ```bash
   rustup target add aarch64-apple-ios aarch64-apple-ios-sim
   ```
4. Install the project generators used by Tauri iOS:
   ```bash
   sudo gem install cocoapods
   brew install xcodegen
   ```
5. Verify prerequisites:
   ```bash
   bash scripts/ios-prereq-check.sh
   ```

## Initialize and Run

1. Generate the iOS project:
   ```bash
   npm run ios:init
   ```
2. Run on a simulator:
   ```bash
   npm run ios:dev
   ```
3. Open the generated Xcode workspace/project when device signing is needed, choose the team `4AFHZKZYQ6`, and run on a connected iPad or iPhone.

## Apple Developer Portal Setup

The owner must create iOS signing assets in the Apple Developer portal or Xcode. Do not put secrets, passwords, private keys, or provisioning profiles in git.

1. Create an Apple Development certificate for device testing.
2. Create an iOS Distribution certificate for TestFlight/App Store or ad hoc distribution.
3. Register the App ID `com.mayor.game`.
4. Create a development provisioning profile for local devices.
5. Create an App Store provisioning profile for TestFlight, and an ad hoc profile if direct device installs are needed outside TestFlight.

## Build, TestFlight, and Ad Hoc

- Local device/simulator debug:
  ```bash
  npm run ios:dev
  ```
- Release build from Tauri:
  ```bash
  npm run ios:build
  ```
- TestFlight upload: archive in Xcode, then use Organizer > Distribute App > App Store Connect.
- Ad hoc export: archive in Xcode, then Organizer > Distribute App > Ad Hoc and choose the ad hoc provisioning profile.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Xcode: not installed` | Only Command Line Tools are selected. | Install Xcode 26.1.1 and run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`. |
| `missing: iPhoneOS SDK` | iOS platform support is not installed. | Open Xcode once and install iOS platform support. |
| `missing: available iOS simulator runtime` | No iOS simulator runtime is installed. | Install an iOS runtime in Xcode Settings > Platforms. |
| Rust target missing | iOS std libraries are not installed. | Run `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`. |
| CocoaPods missing | Tauri cannot install iOS pods. | Run `sudo gem install cocoapods`. |
| XcodeGen missing | Tauri cannot generate the Xcode project. | Run `brew install xcodegen`. |
| Signing fails on a device | Certificate/profile/App ID mismatch. | Use team `4AFHZKZYQ6`, App ID `com.mayor.game`, and a profile that includes the target device. |
| Black or unstable WebGL view | Device texture/GPU limits are lower than desktop. | Use the in-game graphics quality menu; high shadows are capped on iOS by the renderer. |
