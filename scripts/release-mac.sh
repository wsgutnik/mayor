#!/usr/bin/env bash
# Signed + notarized Mac release, done locally. Never put the password in a file or on the command line:
# the first run asks for your Apple ID and app-specific password (hidden prompt) and stores them in the login
# keychain under the profile "mayor-notary" (notarytool store-credentials).
#
#   scripts/release-mac.sh            # build, sign (Developer ID), notarize, staple, verify, copy to release-out/
#   scripts/release-mac.sh --verify   # only verify the current build
#
# Create the app-specific password at https://account.apple.com -> Sign-In and Security -> App-Specific Passwords.
set -euo pipefail
cd "$(dirname "$0")/.."

TEAM="${APPLE_TEAM_ID:-4AFHZKZYQ6}"
PROFILE="${NOTARY_PROFILE:-mayor-notary}"
BUNDLE=src-tauri/target/release/bundle
APP="$BUNDLE/macos/Mayor.app"
OUT=release-out

if [ "${1:-}" = "--verify" ]; then exec bash scripts/sign-mac.sh --verify; fi

IDENTITY="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | head -1)"
[ -n "$IDENTITY" ] || { echo "No 'Developer ID Application' certificate in the login keychain (see docs/SIGNING.md)."; exit 1; }
echo "Signing identity: $IDENTITY"

if ! xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  echo "No notarization profile '$PROFILE' yet. Team ID: $TEAM"
  read -r -p "Apple ID (email): " APPLE_ID
  echo "notarytool will now ask for the app-specific password (input hidden)."
  xcrun notarytool store-credentials "$PROFILE" --apple-id "$APPLE_ID" --team-id "$TEAM"
fi

export APPLE_SIGNING_IDENTITY="$IDENTITY"
npm run ci
rm -f "$BUNDLE"/macos/rw.*.dmg
# Tauri signs the app with the hardened runtime and entitlements. Its dmg step can fail on some machines (Finder
# scripting); the app is already signed at that point, so fall back to a plain hdiutil dmg.
npx tauri build || echo "tauri bundle step failed; building the dmg by hand"
[ -d "$APP" ] || { echo "Mayor.app was not produced"; exit 1; }
codesign --verify --deep --strict "$APP"

VERSION="$(node -p "require('./package.json').version")"
mkdir -p "$BUNDLE/dmg" "$OUT"
DMG="$(ls "$BUNDLE"/dmg/*.dmg 2>/dev/null | head -1 || true)"
if [ -z "$DMG" ]; then
  DMG="$BUNDLE/dmg/Mayor_${VERSION}_aarch64.dmg"
  STAGE="$(mktemp -d)"
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  hdiutil create -volname "Mayor" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
  rm -rf "$STAGE"
fi
codesign --force --sign "$IDENTITY" --timestamp "$DMG"

echo "== notarizing $DMG (profile $PROFILE)"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"
xcrun stapler staple "$APP" || true

echo "== verification"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute --verbose=2 "$APP" || true
xcrun stapler validate "$DMG"
cp "$DMG" "$OUT/Mayor-signed-${VERSION}-mac-arm64.dmg"
( cd "$OUT" && shasum -a 256 "Mayor-signed-${VERSION}-mac-arm64.dmg" | tee -a SHA256SUMS )
echo "Done: $OUT/Mayor-signed-${VERSION}-mac-arm64.dmg"
