#!/usr/bin/env bash
# Check the native iOS prerequisites for Mayor/Tauri without storing secrets.
set -u

missing=0
warns=0

need() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "ok: $2 ($1)"
  else
    echo "missing: $2 ($1)"
    missing=1
  fi
}

warn() {
  echo "warn: $1"
  warns=1
}

version_major_minor() {
  sed -nE 's/.*([0-9]+)\.([0-9]+).*/\1.\2/p' | sed -n '1p'
}

echo "== Xcode"
if command -v xcodebuild >/dev/null 2>&1; then
  xcode_version="$(xcodebuild -version 2>/dev/null | sed -n '1p' | version_major_minor)"
  xcode_path="$(xcode-select -p 2>/dev/null || true)"
  if [ -z "$xcode_version" ]; then
    echo "missing: full Xcode (xcodebuild did not report a version; Command Line Tools alone are not enough)"
    missing=1
  else
    echo "ok: Xcode $xcode_version at ${xcode_path:-unknown path}"
    major="${xcode_version%%.*}"
    minor="${xcode_version#*.}"
    if [ "$major" -ne 26 ]; then
      warn "Mayor expects Xcode 26.0-26.3; install Xcode 26.1.1 from developer.apple.com/download/all when possible"
    elif [ "$minor" -ge 4 ]; then
      warn "Xcode 26.4+ is known to be incompatible with some tools; use 26.0-26.3, preferably 26.1.1"
    fi
  fi
else
  echo "missing: full Xcode (xcodebuild not found)"
  missing=1
fi

echo "== iOS SDK and simulator runtime"
if command -v xcrun >/dev/null 2>&1; then
  if xcrun --sdk iphoneos --show-sdk-path >/dev/null 2>&1; then
    echo "ok: iPhoneOS SDK"
  else
    echo "missing: iPhoneOS SDK"
    missing=1
  fi
  if xcrun simctl list runtimes 2>/dev/null | grep -E 'iOS .+\\(available\\)' >/dev/null; then
    echo "ok: available iOS simulator runtime"
  else
    echo "missing: available iOS simulator runtime"
    missing=1
  fi
else
  echo "missing: xcrun"
  missing=1
fi

echo "== Rust targets"
if command -v rustup >/dev/null 2>&1; then
  for target in aarch64-apple-ios aarch64-apple-ios-sim; do
    if rustup target list --installed | grep -Fx "$target" >/dev/null; then
      echo "ok: Rust target $target"
    else
      echo "missing: Rust target $target (run: rustup target add $target)"
      missing=1
    fi
  done
else
  echo "missing: rustup"
  missing=1
fi

echo "== Tauri iOS generators"
need pod "CocoaPods"
need xcodegen "XcodeGen"

if [ "$missing" -ne 0 ]; then
  echo "result: missing prerequisites above"
  exit 1
fi

if [ "$warns" -ne 0 ]; then
  echo "result: prerequisites present with warnings"
else
  echo "result: all iOS prerequisites present"
fi
