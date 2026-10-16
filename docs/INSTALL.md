# Installing Mayor

## iPad (PWA)

1. Publish the `dist/` folder to any static host with **HTTPS** (Cloudflare Pages, Netlify, GitHub Pages).
   `npm run build` generates `dist/`.
2. In Safari on iPad, open the address, tap Share, then **Add to Home Screen**.
3. Open from the icon: it runs fullscreen and, after the first launch, works without internet.

To test without hosting: run `npm run dev` and open `http://<mac-ip>:5173` in Safari on the iPad.
This works, but without offline mode (service workers require HTTPS or localhost).

Updates: when publishing a new version, increment `VERSION` in `public/sw.js`.

Saving: data stays in Safari storage, which iOS may clear. Use **Menu → Export** to keep a file.

## iPad (native app, Tauri)

The native iPad app (`com.gutnik.mayor`, iPad only) is in App Store review since 2026-10-15; testers install it
through TestFlight (internal group "Equipe"). Building it yourself needs Xcode 26 and the signing assets: see
[IOS.md](IOS.md). Quick commands:

```bash
npm run ios:dev                                          # simulator or cabled iPad
npm run ios:build -- --export-method app-store-connect   # signed IPA for App Store Connect
```

## Browser (paid web demo)

https://mayor-demo.vercel.app: landing page and the browser build for a one-time $4.99 (Stripe). Operations:
[WEB-DEMO.md](WEB-DEMO.md).

## Mac

```bash
npm run desktop:build
```

Generates `src-tauri/target/release/bundle/macos/Mayor.app` and the `.dmg`.
A plain `npm run desktop:build` does not sign or notarize: the first time, open it with right-click → Open.
For a signed build, see the notes below and [SIGNING.md](SIGNING.md).

## Windows

Requires a Windows machine (packaging is always local, with no GitHub Actions):

```bash
npm ci
npm run desktop:build
```

Prerequisites: Node 22, Rust (stable), and WebView2 (already included with Windows 11). Generates `.msi` and `.exe` in
`src-tauri/target/release/bundle/`.

## Mac (ready-made dmg)

The latest release is M36 (pre-release tag `v0.1.0-m36`, 2026-10-15): https://github.com/wsgutnik/mayor/releases/tag/v0.1.0-m36

- `Mayor-m36-mac-arm64-signed-notarized.dmg`: macOS Apple Silicon, Developer ID signed and notarized. Open the dmg and drag Mayor to Applications.
- `Mayor-m36-ipad-pwa.zip`: the PWA bundle for iPad.
- `SHA256SUMS-m36`: checksums for the files above.

M35 (`v0.1.0-m35`) has the same three files with the `m35` prefix.

Fallback when no notarized build is available: `npm run package:adhoc` writes an ad hoc signed dmg to `release-out/`. It is not notarized, so on first launch use right-click > Open. Signing and notarization steps are in [SIGNING.md](SIGNING.md).

## Private remote preview (any network)

The current remote preview address is https://mayor.gutnikcrm.com. It is protected by a shared password, which is not stored in this repository; ask the owner for it.

To serve the PWA from the Mac for viewing away from home, `scripts/serve-gated.mjs` serves `dist/` behind one shared password (HTTP Basic
auth) and a Cloudflare named tunnel publishes it:

```bash
npm run build
MAYOR_GATE_PASSWORD=<password> node scripts/serve-gated.mjs dist 8766
cloudflared tunnel --config ~/.cloudflared/mayor.yml run mayor      # ingress: <host> -> http://127.0.0.1:8766
```

The password is read from the environment and never stored in the repository.
