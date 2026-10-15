#!/usr/bin/env bash
# Local App Store readiness check for Mayor (iPad). Needs no credentials and changes nothing.
# Usage: bash scripts/appstore-prereq-check.sh   (exit 1 when any FAIL)
# See docs/appstore/APPSTORE.md.
set -u
cd "$(dirname "$0")/.." || exit 1

ROOT="$(pwd)"
CONF="src-tauri/tauri.conf.json"
APPLE="src-tauri/gen/apple"
PLIST="$APPLE/app_iOS/Info.plist"
OVERLAY="src-tauri/Info.ios.plist"
PBX="$APPLE/app.xcodeproj/project.pbxproj"
ICONS="$APPLE/Assets.xcassets/AppIcon.appiconset"
DOCS="docs/appstore"

pass=0; fail=0; warn=0
rows=()
row() { # status, check, detail
  rows+=("$1|$2|$3")
  case "$1" in PASS) pass=$((pass+1));; FAIL) fail=$((fail+1));; WARN) warn=$((warn+1));; esac
}
plist_get() { /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2>/dev/null; }
json_get() { node -e 'const j=require(process.argv[1]);const v=process.argv[2].split(".").reduce((o,k)=>o==null?o:o[k],j);console.log(v==null?"":typeof v==="object"?JSON.stringify(v):v)' "$ROOT/$1" "$2" 2>/dev/null; }

# --- toolchain
xv="$(xcodebuild -version 2>/dev/null | sed -n '1s/Xcode //p')"
if [ -z "$xv" ]; then row FAIL "Xcode" "full Xcode not selected (xcode-select -p)"
else
  major="${xv%%.*}"
  if [ "$major" -ge 26 ]; then row PASS "Xcode" "$xv (App Store requires the iOS 26 SDK / Xcode 26+)"
  else row FAIL "Xcode" "$xv: App Store uploads need Xcode 26+"; fi
fi
sdk="$(xcrun --sdk iphoneos --show-sdk-version 2>/dev/null)"
if [ -n "$sdk" ] && [ "${sdk%%.*}" -ge 26 ]; then row PASS "iPhoneOS SDK" "$sdk"; else row FAIL "iPhoneOS SDK" "${sdk:-missing} (need 26+)"; fi
for t in aarch64-apple-ios; do
  if rustup target list --installed 2>/dev/null | grep -qx "$t"; then row PASS "Rust target" "$t"; else row FAIL "Rust target" "$t missing (rustup target add $t)"; fi
done

# --- identity and versions
bid="$(json_get "$CONF" identifier)"
[ "$bid" = "com.gutnik.mayor" ] && row PASS "Bundle id (tauri.conf)" "$bid" || row FAIL "Bundle id (tauri.conf)" "'$bid' != com.gutnik.mayor"
if grep -q "PRODUCT_BUNDLE_IDENTIFIER = com.gutnik.mayor;" "$PBX" && grep -q "PRODUCT_BUNDLE_IDENTIFIER: com.gutnik.mayor" "$APPLE/project.yml"; then
  row PASS "Bundle id (Xcode)" "pbxproj + project.yml"
else row FAIL "Bundle id (Xcode)" "pbxproj/project.yml disagree with com.gutnik.mayor"; fi
team="$(json_get "$CONF" bundle.iOS.developmentTeam)"
[ -n "$team" ] && grep -Eq "DEVELOPMENT_TEAM = \"?$team\"?;" "$PBX" && row PASS "Development team" "$team" || row FAIL "Development team" "'$team' missing or not in pbxproj"
ver="$(json_get "$CONF" version)"; pver="$(json_get package.json version)"
if echo "$ver" | grep -Eq '^[0-9]+\.[0-9]+(\.[0-9]+)?$'; then row PASS "Marketing version" "$ver (CFBundleShortVersionString)"; else row FAIL "Marketing version" "'$ver' must be 1-3 integers"; fi
[ "$ver" = "$pver" ] && row PASS "Version sync" "tauri.conf = package.json = $ver (About screen shows package.json)" || row WARN "Version sync" "tauri.conf $ver vs package.json $pver"
bv="$(json_get "$CONF" bundle.iOS.bundleVersion)"
if echo "$bv" | grep -Eq '^[0-9]+$'; then row PASS "Build number" "bundle.iOS.bundleVersion=$bv (raise for every upload)"; else row FAIL "Build number" "bundle.iOS.bundleVersion '$bv' should be an integer"; fi
fam="$(grep -o 'TARGETED_DEVICE_FAMILY = [^;]*' "$PBX" | sort -u | tr '\n' ' ')"
[ "$fam" = "TARGETED_DEVICE_FAMILY = 2 " ] && row PASS "Device family" "iPad only" || row WARN "Device family" "$fam (iPhone needs its own screenshots)"
minios="$(json_get "$CONF" bundle.iOS.minimumSystemVersion)"
row PASS "Minimum iOS" "${minios:-15.0}"

# --- Info.plist keys (generated plist and Tauri overlay must agree)
for f in "$PLIST" "$OVERLAY"; do
  [ -f "$f" ] || { row FAIL "Info.plist" "$f missing"; continue; }
  name="$(basename "$(dirname "$f")")/$(basename "$f")"
  [ "$(plist_get "$f" UIRequiresFullScreen)" = "true" ] && row PASS "UIRequiresFullScreen" "$name" || row FAIL "UIRequiresFullScreen" "$name: not true"
  o="$(plist_get "$f" 'UISupportedInterfaceOrientations~ipad' | tr -d ' ' | grep -v '[{}]' | sort | tr '\n' ',')"
  [ "$o" = "UIInterfaceOrientationLandscapeLeft,UIInterfaceOrientationLandscapeRight," ] && row PASS "iPad orientations" "$name: landscape L/R" || row FAIL "iPad orientations" "$name: $o"
  [ "$(plist_get "$f" ITSAppUsesNonExemptEncryption)" = "false" ] && row PASS "Export compliance" "$name: ITSAppUsesNonExemptEncryption=false" || row FAIL "Export compliance" "$name: key missing"
done
caps="$(plist_get "$PLIST" UIRequiredDeviceCapabilities | tr -d ' ' | grep -v '[{}]' | tr '\n' ',')"
case "$caps" in *arm64*) row PASS "Required capabilities" "$caps";; *) row FAIL "Required capabilities" "'$caps' (expect arm64[,metal])";; esac
[ -n "$(plist_get "$PLIST" UILaunchStoryboardName)" ] && row PASS "Launch storyboard" "$(plist_get "$PLIST" UILaunchStoryboardName)" || row FAIL "Launch storyboard" "UILaunchStoryboardName missing"
usage="$(grep -ho 'NS[A-Za-z]*UsageDescription' "$PLIST" "$OVERLAY" "$APPLE/project.yml" 2>/dev/null | sort -u | tr '\n' ' ')"
[ -z "$usage" ] && row PASS "Privacy usage strings" "none declared" || row WARN "Privacy usage strings" "declared: $usage (remove if unused)"
apis="$(grep -rlE 'getUserMedia|geolocation\.|DeviceMotionEvent|navigator\.bluetooth|mediaDevices' src --include='*.ts' 2>/dev/null | grep -v '\.test\.ts' | tr '\n' ' ')"
[ -z "$apis" ] && row PASS "Permission APIs used" "none (so no usage strings needed)" || row FAIL "Permission APIs used" "$apis: add NS*UsageDescription"

# --- privacy: no external network, analytics or payments in shipped code
ext="$(grep -rnE "fetch\(\s*['\"\`]https?://|new WebSocket|XMLHttpRequest|sendBeacon|EventSource\(" src --include='*.ts' 2>/dev/null | grep -v '\.test\.ts')"
[ -z "$ext" ] && row PASS "External network calls" "none in src/ (fetch only bundled relative paths)" || row FAIL "External network calls" "$(echo "$ext" | head -1)"
# SDK imports or tracker/payment URLs (plain words like "analytics" in UI text are fine)
trk="$(grep -rnE "(import|from|require)[ (]*['\"][^'\"]*(analytics|sentry|posthog|mixpanel|firebase|stripe|gtag|amplitude)|https?://[^'\"]*(google-analytics|googletagmanager|stripe\.com|sentry\.io|posthog|mixpanel|firebase|vercel)" src --include='*.ts' 2>/dev/null | grep -v '\.test\.ts' | head -1)"
deps="$(json_get package.json dependencies)"
if [ -z "$trk" ] && [ "$deps" = '{"three":"^0.186.1"}' ]; then row PASS "Analytics / payments" "no SDK imports or tracker URLs in src/; runtime deps: three only"
elif [ -z "$trk" ]; then row WARN "Analytics / payments" "runtime deps changed: $deps (review privacy.md)"
else row FAIL "Analytics / payments" "$trk"; fi
csp="$(json_get "$CONF" app.security.csp)"
case "$csp" in *"connect-src 'self' ipc: http://ipc.localhost"*) row PASS "CSP" "connect-src limited to self/ipc";; *) row WARN "CSP" "connect-src changed: review privacy.md";; esac

# --- icons
python3 - "$ICONS" "src-tauri/icons/ios" <<'PY' > /tmp/mayor-icon-check.$$ 2>&1
import json, os, sys
try:
    from PIL import Image
except ImportError:
    print("WARN|Icons|Pillow missing: pip3 install pillow"); sys.exit(0)
cat = sys.argv[1]
c = json.load(open(os.path.join(cat, "Contents.json")))
mk = [i for i in c["images"] if i.get("idiom") == "ios-marketing"]
if not mk:
    print("FAIL|App Store icon|no ios-marketing entry")
else:
    p = os.path.join(cat, mk[0]["filename"]); im = Image.open(p)
    alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info
    ok = im.size == (1024, 1024) and not alpha
    # rounded/white corners: the four corner pixels must not all be pure white or transparent
    rgb = im.convert("RGB"); corners = [rgb.getpixel(q) for q in [(0, 0), (1023, 0), (0, 1023), (1023, 1023)]]
    white = all(min(px) > 245 for px in corners)
    print(("PASS" if ok and not white else "FAIL") + f"|App Store icon|{mk[0]['filename']} {im.size} mode={im.mode}{' WHITE CORNERS' if white else ''}")
bad = []
for d in sys.argv[1:]:
    for f in sorted(os.listdir(d)):
        if f.endswith(".png"):
            im = Image.open(os.path.join(d, f))
            if im.mode in ("RGBA", "LA") or "transparency" in im.info: bad.append(f"{os.path.basename(d)}/{f}")
missing = [i["filename"] for i in c["images"] if not os.path.exists(os.path.join(cat, i.get("filename", "")))]
print(("PASS" if not bad else "FAIL") + "|Icons opaque|" + ("all AppIcon PNGs without alpha" if not bad else ", ".join(bad[:4])))
print(("PASS" if not missing else "FAIL") + "|Icon set complete|" + (f"{len(c['images'])} entries present" if not missing else ", ".join(missing)))
PY
while IFS= read -r l; do IFS='|' read -r s n d <<< "$l"; row "$s" "$n" "$d"; done < /tmp/mayor-icon-check.$$
rm -f /tmp/mayor-icon-check.$$

# --- metadata files and character limits (text inside ```text blocks under "## Field (limit N)")
for f in "$DOCS/metadata.pt-BR.md" "$DOCS/metadata.en.md" "$DOCS/privacy.md" "$DOCS/review-notes.md" "$DOCS/APPSTORE.md"; do
  [ -f "$f" ] && row PASS "Doc present" "$f" || row FAIL "Doc present" "$f missing"
done
python3 - "$DOCS/metadata.pt-BR.md" "$DOCS/metadata.en.md" <<'PY' > /tmp/mayor-meta-check.$$ 2>&1
import re, sys
for path in sys.argv[1:]:
    try: s = open(path, encoding="utf-8").read()
    except OSError: continue
    lang = path.split("metadata.")[1].rsplit(".md", 1)[0]
    for m in re.finditer(r"^## ([^\n]+?) \(limit (\d+)\)[ \t]*\n+```text\n(.*?)\n```", s, re.S | re.M):
        field, limit, text = m.group(1), int(m.group(2)), m.group(3)
        n = len(text)
        extra = ""
        if "eyword" in field or "chave" in field:
            words = text.split(",")
            dup = len(words) != len(set(w.strip().lower() for w in words))
            extra = f", {len(words)} words" + (", DUPLICATES" if dup else "") + (", spaces after commas waste chars" if ", " in text else "")
            ok = n <= limit and not dup
        else:
            ok = 0 < n <= limit
        print(("PASS" if ok else "FAIL") + f"|{lang} {field}|{n}/{limit} chars{extra}")
PY
while IFS= read -r l; do IFS='|' read -r s n d <<< "$l"; row "$s" "$n" "$d"; done < /tmp/mayor-meta-check.$$
rm -f /tmp/mayor-meta-check.$$

# --- screenshots (13-inch iPad: 2752x2064 or 2064x2752, 1 to 10 per language)
for lang in en pt; do
  n=0; badsz=""
  for f in "$DOCS"/screenshots/ipad13-"$lang"-*.jpg "$DOCS"/screenshots/ipad13-"$lang"-*.png; do
    [ -f "$f" ] || continue
    n=$((n+1))
    w="$(sips -g pixelWidth "$f" 2>/dev/null | awk '/pixelWidth/{print $2}')"; h="$(sips -g pixelHeight "$f" 2>/dev/null | awk '/pixelHeight/{print $2}')"
    case "${w}x${h}" in 2752x2064|2064x2752|2732x2048|2048x2732) ;; *) badsz="$badsz $(basename "$f")=${w}x${h}";; esac
  done
  if [ "$n" -ge 1 ] && [ "$n" -le 10 ] && [ -z "$badsz" ]; then row PASS "Screenshots $lang" "$n at 13-inch size"; else row FAIL "Screenshots $lang" "count=$n$badsz"; fi
done

# --- report
printf '\n%-6s  %-28s  %s\n' "STATUS" "CHECK" "DETAIL"
printf '%-6s  %-28s  %s\n' "------" "----------------------------" "------"
for r in "${rows[@]}"; do IFS='|' read -r s n d <<< "$r"; printf '%-6s  %-28s  %s\n' "$s" "$n" "$d"; done
printf '\n%d pass, %d warn, %d fail\n' "$pass" "$warn" "$fail"
echo "Not checkable locally (owner): agreements, App ID, distribution certificate, provisioning profile, App Store Connect record, upload, validation."
[ "$fail" -eq 0 ]
