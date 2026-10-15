# Privacy, App Privacy label and export compliance

## 1. Audit (what the app actually does), 2026-10-15

Checked in this worktree; repeat before each submission (the commands are in
`scripts/appstore-prereq-check.sh`, section "privacy").

| Check | Finding |
|---|---|
| `fetch(` in `src/` | 4 calls, all **relative paths to bundled files**: `/maps/index.json` and the map data (`src/main.ts`, `src/ui/menu.ts`), `/models/patterns.json` (`src/render/kit-materials.ts`). In the iPad app these resolve to the app bundle (Tauri custom scheme), never to the internet. |
| `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource` | None. |
| Absolute `http(s)://` URLs in shipped code | Only display text in the About and credits screen (`src/ui/credits.ts`: licence source links, not clickable, never requested). None in `index.html`, `public/sw.js`, `public/manifest.webmanifest` or `src-tauri/src`. |
| Content Security Policy (`src-tauri/tauri.conf.json`) | `default-src 'self'; connect-src 'self' ipc: http://ipc.localhost`: the WebView cannot contact any external host even by mistake. |
| Analytics, telemetry, crash SDKs, ads (`analytics`, `telemetry`, `gtag`, `sentry`, `posthog`, `mixpanel`, `firebase`, ad networks) | None in `src/`, `package.json` dependencies (only `three`) or `src-tauri/Cargo.toml`. |
| Accounts, login, payments | None. The public web demo paywall (Vercel/Stripe, separate `~/mayor-site` package) is not in this codebase or the app. |
| Storage | `localStorage` only (`src/storage.ts`: 3 save slots + autosave, `src/prefs.ts`: preferences). Stays on the device, inside the app sandbox. |
| Export/Import of a save file | User-initiated: Import opens the system file picker; Export creates a local file. Nothing is uploaded. |
| Device permissions (camera, microphone, location, photos, contacts, tracking, Bluetooth, motion) | None used; no `NS*UsageDescription` keys in `src-tauri/gen/apple/app_iOS/Info.plist` or `src-tauri/Info.ios.plist`, and none are needed. |
| Native side (Rust) | `src-tauri/src/lib.rs` only starts Tauri; `tauri-plugin-log` is registered **only in debug builds** and writes to the local console. `reqwest` is compiled in as a Tauri dependency but with **no TLS backend** (`cargo tree -i rustls` / `-i native-tls`: no match) and the app never calls it. |
| Service worker (`public/sw.js`) | Registered for the PWA only; it caches same-origin files. In the native app registration fails silently (custom scheme) and has no effect. |
| Haptics | None (no `navigator.vibrate` or native haptics). |

Honest caveats: (a) Apple itself collects crash and usage data for apps whose users opted in to
"Share with App Developers"; that is Apple's collection, not the developer's, and is not declared
in the label. (b) If analytics, crash reporting, accounts, online maps or purchases are ever added,
the label and policy below must be updated before that build is submitted.

## 2. App Privacy "nutrition label" answers (App Store Connect > App Privacy)

1. **Do you or your third-party partners collect data from this app?** No, we do not collect data
   from this app.
2. Result shown on the product page: **Data Not Collected**.
3. Tracking: **No** (no data is used to track users; no `NSUserTrackingUsageDescription`, no
   App Tracking Transparency prompt).
4. Privacy Policy URL: required even with no data collected; host the text below (for example at
   `https://mayor-demo.vercel.app/privacy` and `/privacidade`) and paste the URL in App Information.
5. Privacy manifest: the app ships no third-party SDKs that require a `PrivacyInfo.xcprivacy`.
   `localStorage` in WKWebView is not a "required reason API" call made by the app binary.
   OWNER CHECK: if Xcode's "Generate Privacy Report" (Organizer > archive > right-click) or the
   upload validation lists a required-reason API from the Tauri/Rust binary (for example file
   timestamp or system boot time APIs used by Rust std), add `src-tauri/gen/apple/app_iOS/PrivacyInfo.xcprivacy`
   declaring that API with the matching reason code (for example `C617.1` for file timestamps inside
   the app container, `35F9.1` for system boot time) and `NSPrivacyCollectedDataTypes` empty,
   `NSPrivacyTracking` false. This is not added preemptively because the exact list must come from
   the report of the signed build.

## 3. Export compliance

- The app contains **no encryption of its own** and makes **no network connections**. It uses only
  encryption built into iOS (if any WebKit/TLS code is present, it is the operating system's and is
  exempt), and the Rust `reqwest` crate is compiled without any TLS library.
- `ITSAppUsesNonExemptEncryption = false` is already set in `src-tauri/Info.ios.plist` (merged by
  Tauri), in `src-tauri/gen/apple/app_iOS/Info.plist`, and in `src-tauri/gen/apple/project.yml` (so a
  regenerated project keeps it). With this key App Store Connect does not ask the export compliance
  question for each build.
- If App Store Connect still asks: "Does your app use encryption?" **No** (or: "Yes, only exempt
  encryption: standard encryption provided by the operating system"). No ERN/annual self
  classification report is required for "No".

## 4. Privacy policy (ready to host)

### English

```text
Mayor Privacy Policy
Last updated: 15 October 2026

Mayor is a city-building game developed by Willian Gutnik ("we").

Data we collect: none. Mayor does not collect, store on our servers, share or sell any personal
information or usage data. The app has no accounts, no advertising, no analytics, no tracking and
no in-app purchases, and it does not connect to the internet.

Data on your device: the cities you save and your game preferences (language, graphics, tips) are
stored only on your device, inside the app's private storage. They never leave the device unless you
choose to export a save file yourself. Deleting the app deletes this data.

Permissions: Mayor does not request access to your camera, microphone, photos, contacts, location or
any other personal data.

Children: Mayor is suitable for all ages and collects no information from anyone, including children.

Apple: if you have chosen to share analytics with app developers in your device settings, Apple may
provide us with aggregated, anonymous crash and usage statistics under Apple's own privacy policy. We
do not receive personal information from these reports.

Changes: if this policy changes, the new version will be published at this address with a new date.

Contact: github.com/wsgutnik/mayor/issues
```

### Português (Brasil)

```text
Política de Privacidade do Mayor
Última atualização: 15 de outubro de 2026

Mayor é um jogo de construção de cidades desenvolvido por Willian Gutnik ("nós").

Dados que coletamos: nenhum. O Mayor não coleta, não guarda em servidores, não compartilha e não vende
nenhuma informação pessoal ou dado de uso. O app não tem contas, anúncios, análises, rastreamento nem
compras dentro do app, e não se conecta à internet.

Dados no seu aparelho: as cidades que você salva e suas preferências (idioma, gráficos, dicas) ficam
guardadas apenas no seu aparelho, no armazenamento privado do app. Elas só saem do aparelho se você
mesmo exportar um arquivo de save. Ao apagar o app, esses dados são apagados.

Permissões: o Mayor não pede acesso à câmera, ao microfone, às fotos, aos contatos, à localização nem a
qualquer outro dado pessoal.

Crianças: o Mayor é adequado para todas as idades e não coleta informações de ninguém, inclusive de
crianças.

Apple: se você escolheu compartilhar análises com desenvolvedores nos ajustes do aparelho, a Apple pode
nos fornecer estatísticas agregadas e anônimas de falhas e uso, conforme a política de privacidade da
própria Apple. Não recebemos informações pessoais nesses relatórios.

Alterações: se esta política mudar, a nova versão será publicada neste endereço com nova data.

Contato: github.com/wsgutnik/mayor/issues
```

OWNER: replace `github.com/wsgutnik/mayor/issues` (both languages) with the public support address you want to show, and
confirm the controller name for LGPD/GDPR.
