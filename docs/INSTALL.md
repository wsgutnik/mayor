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

## iPad/iPhone (native iOS, Tauri)

Native iOS packaging is prepared but requires full Xcode, iOS signing assets, and provisioning profiles. See
[IOS.md](IOS.md). Quick commands after prerequisites are installed:

```bash
npm run ios:init
npm run ios:dev
npm run ios:build
```

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

The M34 release (pre-release tag `v0.1.0-m34`) is on the GitHub Releases page: https://github.com/wsgutnik/mayor/releases/tag/v0.1.0-m34

- `Mayor-m34-mac-arm64-signed-notarized.dmg`: macOS Apple Silicon, Developer ID signed and notarized. Open the dmg and drag Mayor to Applications.
- `Mayor-m34-ipad-pwa.zip`: the PWA bundle for iPad.
- `SHA256SUMS-m34`: checksums for the files above.

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
