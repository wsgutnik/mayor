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

## Mac

```bash
npm run desktop:build
```

Generates `src-tauri/target/release/bundle/macos/Mayor.app` and the `.dmg`.
The app is not signed or notarized: the first time, open it with right-click → Open.

## Windows

Requires a Windows machine (packaging is always local, with no GitHub Actions):

```bash
npm ci
npm run desktop:build
```

Prerequisites: Node 22, Rust (stable), and WebView2 (already included with Windows 11). Generates `.msi` and `.exe` in
`src-tauri/target/release/bundle/`.

## Mac (ready-made dmg)

The latest installer is in the private repository Releases: https://github.com/wsgutnik/mayor/releases
(`Mayor-*-aarch64.dmg`, Apple Silicon). Local builds land in `release-out/` (`npm run package:adhoc`, then copy the dmg and zip `dist/` for the iPad PWA); they are ad hoc signed and not notarized. Open the dmg, drag Mayor to Applications, and on first launch use
right-click > Open (the app is unsigned). Generated locally with `npm run package`. For the unsigned-app warning and
how to notarize, see [SIGNING.md](SIGNING.md).

## Private remote preview (any network)

For viewing the PWA away from the Mac, `scripts/serve-gated.mjs` serves `dist/` behind one shared password (HTTP Basic
auth) and a Cloudflare named tunnel publishes it:

```bash
npm run build
MAYOR_GATE_PASSWORD=<password> node scripts/serve-gated.mjs dist 8766
cloudflared tunnel --config ~/.cloudflared/mayor.yml run mayor      # ingress: <host> -> http://127.0.0.1:8766
```

The password is read from the environment and never stored in the repository.
