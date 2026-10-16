# App Review notes and rejection risks

## 1. Notes for App Review (paste into App Store Connect > App Review Information > Notes)

```text
Mayor is a single-player city-building game for iPad. It works fully offline, has no login, no accounts, no in-app purchases, no ads and no data collection, so no demo account is needed.

How to play (first 2 minutes):
1. On first launch a new city opens on an empty landscape with a short highway entry at the left edge. A "Getting started" card (top left) walks through four steps.
2. Tap Roads (first button in the bottom toolbar), then drag across the ground from the highway entry and release: a street is built (streets, avenues, one-way roads, highways, curves, roundabouts, bridges and tunnels are in the same menu).
Roads menu also has Ramp and the diamond Interchange tool: draw a highway, pick Ramp and connect at a shallow angle (10–30°) to merge/diverge, or use Interchange on a highway crossing a street to build all four ramps at once.
3. Tap Zones > Residential and drag over the ground next to the road to paint a zone.
4. Tap Services and place a Power plant and a Water tower near the road (they feed the network along the roads).
5. Tap the 2x speed button in the top bar: lots start construction and residents move in within seconds; the R/C/I demand bars (top left) say what to zone next.
6. Tap Move (hand icon) and then any building to open its inspector; service buildings show how many buildings, residents and jobs they serve. The Infoview button shows coverage maps; Economy shows the budget and city statistics.

Gestures: one finger draws or uses the selected tool, two fingers pan, pinch zooms, twist rotates.
Menu (gear icon, top bar): save slots, autosave, new city (random terrain or official maps), preferences (language Portuguese/English, graphics quality, day/night) and "About and credits" (licences and privacy statement).

The game language follows the device (Portuguese for pt devices, English otherwise) and can be changed in Menu > Preferences.

Mayor is an original game. It is inspired by the city-builder genre but contains no code, art, names or assets from any other game; third-party assets are CC0 or MIT-licensed and credited in Menu > About and credits.
```

App Review contact: owner's name, phone and email (owner fills in App Store Connect; not stored in git).

## 2. Risks that could cause rejection, with mitigations

| # | Guideline | Risk | Mitigation (done / owner) |
|---|---|---|---|
| 1 | 4.2 Minimum functionality / web wrapper | Mayor is a Tauri app: the game runs in a WKWebView, which reviewers sometimes treat as a "repackaged website". | Done: all code and assets are bundled in the IPA and run offline (CSP forbids external connections, no remote URL is loaded); full-screen landscape game, touch-first controls (draw, pinch, twist), native launch screen, native icon, no browser chrome, no links out. The notes above describe deep native-feeling gameplay. Owner: if rejected under 4.2, reply that the app is a complete offline game built with a native shell (Tauri/WKWebView, like many engines), not a website, and point at offline play with Airplane Mode. Optional future work: native haptics (none today) and Game Center would strengthen the case. |
| 2 | 4.0 Design | UI must look finished on every iPad size, including iPad mini (8.3") with the side panels and inspector. | Done: screenshots at 13-inch show no overlap. Owner: in TestFlight, check iPad mini and 11-inch in both landscape orientations (panels, toolbar, menu, About screen, inspector). |
| 3 | 2.1 App completeness / crashes | WebGL memory or GPU limits on older iPads (minimum iOS 15, any iPad with Metal) could crash or show a black view; hardware performance has never been measured on a real iPad (PROGRESS.md). | Owner: run the TestFlight build on the oldest iPad available for 15 minutes with a grown city, at each graphics quality; the renderer drops resolution on slow frames and caps shadows on iOS. If unstable, raise the minimum iOS version or default to Medium quality on iOS. |
| 4 | 2.1 / 2.3.1 | "Export" save file may do nothing inside WKWebView on iOS (it uses an `<a download>` blob link, which WKWebView does not handle without a download delegate). A dead button is a common rejection reason. | Not verified (no device run in this pass). Owner: test Menu > Save file > Export and Import on the TestFlight build. If Export does nothing, hide the Export button on iOS before submitting (small change in `src/ui/menu.ts`), or implement it through the share sheet. The metadata does not promise export. |
| 5 | 5.2.1 / 5.2.5 Intellectual property | The game is described internally as "inspired by Cities: Skylines". Using that name, Paradox/Colossal Order marks or look-alike art in the store listing would be risky. | Done: store text, keywords and screenshots never name another game; keywords avoid trademarks (no "SimCity", "Skylines"). In-app About states it is original and not affiliated. NOTICE.md confirms no code, models, textures, sounds or UI from those games are in the repo; reference screenshots stay out of git. |
| 6 | 5.2.1 Third-party content | Assets from Kenney (CC0), Poly Haven (CC0), ambientCG via Fable Cities (CC0) and code adapted from Fable Cities (MIT). | Done: new in-app Menu > About and credits lists every source and licence and includes the full Fable Cities MIT notice, which satisfies the MIT attribution requirement in the shipped app (`src/ui/credits.ts`, test `src/ui/credits.test.ts` keeps it in sync with NOTICE.md). |
| 7 | 5.2 / 2.3 AI-generated art | Some textures, building inspector illustrations, the brand banner and the app icon were generated with AI tools (Higgsfield, ChatGPT Image, Midjourney) on the owner's accounts. Apple has no AI-disclosure rule, but generated images must not contain third-party marks or recognisable copyrighted characters. | Done: disclosed in About and credits and NOTICE.md; prompts were generic. Owner: confirm the tools' terms grant commercial rights for your plan, and eyeball the inspector illustrations for stray logos or text (one card shows the word "HOSPITAL", which is fine). |
| 8 | 2.3.3 Screenshots | Screenshots must show the app in use. | Done: produced from the running game (web build of the same code at the exact iPad Pro 13" CSS viewport 1376x1032 at 2x, same renderer and UI as the WKWebView app). The city was grown by the simulation and then topped up with a script (building levels set directly) to fill empty lots; every model, panel and number is real game output. Owner: optionally replace with simulator/device captures from the TestFlight build. |
| 9 | 2.3.8 Icon | The icon previously in `src-tauri/gen/apple/Assets.xcassets` was the **default Tauri logo** (the IPA built on 2026-10-15 still contains it), and the Mayor source icon had baked-in rounded corners. | Done: replaced all iOS AppIcon sizes with a full-bleed square, opaque Mayor icon (`docs/appstore/icon-1024.png`). Do not upload any IPA built before this change. |
| 10 | 2.5.1 / platform | `UIRequiresFullScreen` is deprecated in iPadOS 26 (Apple wants resizable windows); still accepted today. | Keep for now (it also avoids the "all four orientations required" validation error for landscape-only iPad apps). Plan a resizable-window pass later. |
| 11 | 2.3.6 / age rating | Fires destroy buildings; hospitals exist. | Questionnaire answers are all "None" → 4+ (no people harmed on screen, no medical advice). |
| 12 | 3.1 Payments | The public web demo has a Stripe paywall. Any mention or link to it in the app would violate 3.1.1/3.1.3. | Done: the app has no purchase flow, link or text about the paywall (grep for `stripe`, `checkout`, `paywall`, `vercel` in `src/`: no match). Keep it that way; the Marketing URL may point to the demo site, but that site should not ask iPad App Store users to pay outside the store for the same app. |
| 13 | 2.1 Device family | The Xcode project targeted iPhone and iPad; iPhone would need its own screenshots and a phone-sized UI review. | Done: `TARGETED_DEVICE_FAMILY = 2` (iPad only) in `project.pbxproj` and `project.yml`. Re-enable iPhone later with `"1,2"` plus iPhone 6.9" screenshots. |
| 14 | Guideline 2.5.2 / private APIs | Tauri/wry uses only public WebKit APIs; no downloaded code. | Nothing to do; game code is bundled and never fetched remotely. |
