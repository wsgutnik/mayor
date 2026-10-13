#!/usr/bin/env bash
# Build, sign and notarize the Mayor macOS app and dmg, locally (no CI).
#
#   scripts/sign-mac.sh              # needs a Developer ID Application certificate in the login keychain
#   scripts/sign-mac.sh --adhoc      # no certificate: ad-hoc signature with the right identifier (still warns on other Macs)
#   scripts/sign-mac.sh --verify     # only check the current build
#
# Environment (never commit these):
#   APPLE_SIGNING_IDENTITY   e.g. "Developer ID Application: Your Name (TEAMID1234)"
#   NOTARY_PROFILE           keychain profile created once with:
#                              xcrun notarytool store-credentials mayor-notary --apple-id you@example.com \
#                                --team-id TEAMID1234 --password <app-specific-password>
#                            (defaults to "mayor-notary")
set -euo pipefail
cd "$(dirname "$0")/.."

BUNDLE=src-tauri/target/release/bundle
APP="$BUNDLE/macos/Mayor.app"
MODE="${1:-sign}"

verify() {
  echo "== codesign"; codesign --verify --deep --strict --verbose=2 "$APP"
  codesign -dv --verbose=2 "$APP" 2>&1 | grep -E "Identifier|Authority|TeamIdentifier|flags|Signature" || true
  echo "== Gatekeeper"; spctl --assess --type execute --verbose=2 "$APP" || true
  if ls "$BUNDLE"/dmg/*.dmg >/dev/null 2>&1; then
    echo "== staple"; xcrun stapler validate "$BUNDLE"/dmg/*.dmg || true
  fi
}

if [ "$MODE" = "--verify" ]; then verify; exit 0; fi

if [ "$MODE" = "--adhoc" ]; then
  export APPLE_SIGNING_IDENTITY="-"
  echo "Ad-hoc signing (identity '-'): fixes the app identifier and the sealed resources, but Gatekeeper still asks"
  echo "other Macs for 'Open anyway'. A paid Developer ID is needed to remove the warning."
else
  : "${APPLE_SIGNING_IDENTITY:?set APPLE_SIGNING_IDENTITY to your 'Developer ID Application: ...' identity}"
  security find-identity -v -p codesigning | grep -F "$APPLE_SIGNING_IDENTITY" >/dev/null \
    || { echo "identity not found in the keychain: $APPLE_SIGNING_IDENTITY"; exit 1; }
fi

npm run ci
npx tauri build           # signs with APPLE_SIGNING_IDENTITY and the hardened runtime + entitlements.plist

DMG=$(ls "$BUNDLE"/dmg/*.dmg | head -1)
if [ "$MODE" != "--adhoc" ]; then
  PROFILE="${NOTARY_PROFILE:-mayor-notary}"
  echo "== notarizing $DMG (profile $PROFILE)"
  xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
  xcrun stapler staple "$DMG"
  xcrun stapler staple "$APP" || true
fi
verify
echo "Done: $DMG"
