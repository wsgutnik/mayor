#!/usr/bin/env bash
# One-time helper for the Developer ID Application certificate, done locally.
#   scripts/mac-cert-setup.sh csr "Your Name" you@example.com   # creates a private key + certificate signing request
#   scripts/mac-cert-setup.sh import ~/Downloads/developerID_application.cer   # pairs the downloaded certificate and installs it
#   scripts/mac-cert-setup.sh notary TEAMID APPLE_ID            # asks for the app-specific password and stores it in the keychain
# The key and request live in ~/.mayor-signing (mode 700), never in the repository.
set -euo pipefail
DIR="$HOME/.mayor-signing"
mkdir -p "$DIR" && chmod 700 "$DIR"
case "${1:-}" in
  csr)
    NAME="${2:?name}"; MAIL="${3:?email}"
    [ -f "$DIR/mayor.key" ] || openssl genrsa -out "$DIR/mayor.key" 2048
    chmod 600 "$DIR/mayor.key"
    openssl req -new -key "$DIR/mayor.key" -out "$DIR/mayor.csr" -subj "/emailAddress=$MAIL/CN=$NAME/C=US"
    echo "CSR: $DIR/mayor.csr"
    echo "Upload it at https://developer.apple.com/account/resources/certificates/add (Developer ID Application),"
    echo "download the .cer, then run: scripts/mac-cert-setup.sh import <file.cer>"
    ;;
  import)
    CER="${2:?path to the .cer}"
    openssl x509 -inform DER -in "$CER" -out "$DIR/cert.pem" 2>/dev/null || cp "$CER" "$DIR/cert.pem"
    curl -fsSL https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer -o "$DIR/ca.cer"
    openssl x509 -inform DER -in "$DIR/ca.cer" -out "$DIR/ca.pem"
    PASS="$(openssl rand -hex 16)"
    openssl pkcs12 -export -inkey "$DIR/mayor.key" -in "$DIR/cert.pem" -certfile "$DIR/ca.pem" -out "$DIR/mayor.p12" -passout "pass:$PASS"
    security import "$DIR/mayor.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P "$PASS" -T /usr/bin/codesign -T /usr/bin/security
    security import "$DIR/ca.cer" -k "$HOME/Library/Keychains/login.keychain-db" >/dev/null 2>&1 || true
    rm -f "$DIR/mayor.p12"
    security find-identity -v -p codesigning
    ;;
  notary)
    TEAM="${2:?team id}"; APPLE_ID="${3:?apple id}"
    xcrun notarytool store-credentials mayor-notary --apple-id "$APPLE_ID" --team-id "$TEAM"   # prompts for the app-specific password
    ;;
  *) echo "usage: $0 csr NAME EMAIL | import FILE.cer | notary TEAMID APPLE_ID"; exit 2 ;;
esac
