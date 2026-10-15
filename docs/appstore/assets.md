# Store assets checklist

## App icon

| Item | State |
|---|---|
| 1024x1024 App Store icon, opaque (no alpha), square (no rounded corners, iOS applies the mask) | Done: `src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` (idiom `ios-marketing`), copy at `docs/appstore/icon-1024.png`. App Store Connect takes the icon from the uploaded build. |
| All iPad/iPhone AppIcon sizes (20 to 167 pt, 18 files) | Done in `src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/` (used by Xcode; opaque RGB). Correction 2026-10-15: `src-tauri/icons/ios/AppIcon-512@2x.png` in git is still RGBA, so the prereq script's "Icons opaque" check fails on it; the shipped builds use the Xcode asset catalog. Regenerate the Tauri source set before any `tauri ios init`. |
| What was wrong before | The Xcode asset catalog held the **default Tauri logo**; the Mayor icon in `src-tauri/icons/ios/` had baked-in white rounded corners. The new icon is the Mayor artwork cropped 72 px per side (past the corner radius) and rescaled to 1024. |
| Optional improvement | The source artwork is an upscaled AI image and slightly soft at 1024; a crisper redraw (same composition) would look better on the product page. Xcode 26 also accepts an Icon Composer `.icon` file for the iOS 26 "liquid glass" look; not required. |

Verified by `scripts/appstore-prereq-check.sh` (size, alpha, presence).

## Screenshots (iPad)

Apple's current rule (App Store Connect, 2026): an app that runs on iPad must provide iPad
screenshots for the **13-inch display**: 2064x2752 or 2752x2064 px (2048x2732 / 2732x2048 is also
accepted). Smaller iPad sizes (11-inch 1668x2420 / 2420x1668, 1640x2360, 1488x2266) are optional:
App Store Connect scales the 13-inch set down when they are missing. 1 to 10 screenshots per
localization, PNG or JPEG, no alpha. iPhone screenshots are not needed because the app is now iPad
only.

Produced (landscape 2752x2064, JPEG q90, RGB) in `docs/appstore/screenshots/` (local only: excluded from git by the
`screenshots/` pattern in `.gitignore`; present in the owner's main checkout and uploaded to App Store Connect):

| File (en / pt) | Content |
|---|---|
| `ipad13-en-01-overview.jpg` / `ipad13-pt-01-overview.jpg` | Day overview of a ~4,300-resident city: street grid with avenue spines, residential, commercial and industrial zones, HUD with indicators and service bars. |
| `ipad13-en-02-junction.jpg` / `ipad13-pt-02-junction.jpg` | Close-up of the avenue x avenue signalised junction (crosswalks, turn arrows, medians, signals), side panels hidden. |
| `ipad13-en-03-night.jpg` / `ipad13-pt-03-night.jpg` | Night view with lit windows. |
| `ipad13-en-04-services.jpg` / `ipad13-pt-04-services.jpg` | General Hospital inspector: upkeep, footprint, radius and usage numbers (buildings, residents, jobs served). |
| `ipad13-en-05-economy.jpg` / `ipad13-pt-05-economy.jpg` | Economy and city statistics panel with indicators and services. |

Rejected while producing them: an empty starting map; a staged city with unserved lots (orange
warning markers everywhere, services in the red); a pt-BR inspector capture where a stray tap had
started a road (red preview and an error toast); a misframed overview with half the frame empty.

How they were made (reproducible, see `shot-tools/`): the dev server (`npx vite --port 5191`) is
driven over the Chrome DevTools Protocol. `build.js` lays out roads, services and zones on seed 30
and runs the simulation; `supply.js`, `more.js`, `fill.js` and `stage.js`/`restage.js` add utility
capacity and set building levels on remaining empty lots; the city is stored in save slot 2 and
reloaded with `load.js` (language from `mayor:prefs`). `tileshot.mjs` captures the 1376x1032 CSS
viewport at device scale 2 as 4x2 clipped tiles and stitches them (single full-size captures hang in
Chrome 155 on this Mac). Honest note: these are captures of the web build of the same code at the
iPad Pro 13" viewport, not of the WKWebView app in the simulator; fonts, renderer and UI are the
same code. The owner may replace them with simulator captures from the signed build
(`xcrun simctl io booted screenshot file.png` on "iPad Pro 13-inch (M5)", landscape).

## Other listing assets

| Item | Needed? | State |
|---|---|---|
| App preview video | Optional | Not made. |
| Promotional text, description, keywords, What's New | Required (What's New only for updates) | `metadata.pt-BR.md`, `metadata.en.md` (limits checked by the prereq script). |
| Support URL, Privacy Policy URL | Required | Placeholders on `mayor-demo.vercel.app`; owner must publish the pages (`privacy.md` has the policy text). |
| Age rating | Required | Answers in `metadata.en.md` (4+). |
