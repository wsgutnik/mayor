# Web demo and marketing site (ops note)

Public site: https://mayor-demo.vercel.app (Vercel project `mayor-demo`). The landing page is free; the playable web
build sits behind a one-time $4.99 Stripe Checkout payment. The site source is **not** in this repository: it lives
in `~/mayor-site` on the owner's Mac (not a git repository; `mayor-site.tar.gz` there is a manual backup). This note
is the only written description of it. No secrets are recorded here: env var names only.

The iPad App Store app must never mention or link to the paywall (App Store guideline 3.1; risk 12 in
`docs/appstore/review-notes.md`). `scripts/appstore-prereq-check.sh` greps `src/` for payment code.

## Layout of `~/mayor-site`

| Path | What it is |
|---|---|
| `index.html` | Landing page, single file (inline CSS and JS, Google Fonts only). EN in the HTML, pt-BR from an in-page dictionary, system/light/dark theme, device mockups, day/night comparison slider, FAQ, pricing card. Its buttons POST to `/api/checkout` and redirect to the returned Stripe URL. |
| `site/img/`, `site/mockups/` | WebP captures, icons, `og.jpg`; SVG device mockups (deployed). `site/mockups/*.png` and `site/mockups/appstore/` are local-only exports (`.vercelignore`). |
| `demo/index.html` | Gate page. On return from Stripe (`/demo?session_id=...`) it calls `/api/verify`; with a valid cookie it opens `/game/index.html`; otherwise it offers checkout and "restore by email" (`/api/restore`). |
| `game/` | The game: a copy of this repo's `dist/` (web build). |
| `api/checkout.js` | Serverless function: creates a Checkout Session, `mode: 'payment'`, one line item `STRIPE_PRICE_ID`, `success_url` `/demo?session_id={CHECKOUT_SESSION_ID}`, `cancel_url` `/`. |
| `api/verify.js` | Accepts an existing signed `mayor_demo` cookie, or retrieves the session and grants access only if `payment_status === 'paid'` **and** a line item uses `STRIPE_PRICE_ID`; then sets the cookie. |
| `api/restore.js` | `POST { email }`: lists Checkout Sessions by `customer_details.email`, finds a paid one with the demo price, and sets the cookie. |
| `api/package.json` | `stripe` ^17.5.0. All functions pin `apiVersion: '2025-03-31.basil'`. |
| `middleware.js` | Edge middleware: `/game/*`, `/assets/*`, `/models/*`, `/textures/*`, `/ui/*`, `/maps/*`, `/icons/*` are served only with a valid HMAC-SHA256 `mayor_demo` cookie; otherwise redirect to `/demo`. |
| `vercel.json` | `cleanUrls`; rewrites `/assets`, `/models`, `/textures`, `/ui`, `/maps`, `/icons`, `/manifest.webmanifest`, `/favicon.png`, `/mayor-logo.jpg` to `/game/...` (the bundle is built with base `/`); `/game/*` gets `Cache-Control: private, max-age=3600` and `X-Robots-Tag: noindex`. |
| `privacy.html`, `privacidade.html`, `support.html`, `suporte.html` | Served as `/privacy`, `/privacidade`, `/support`, `/suporte` (clean URLs). These are the App Store privacy policy and support URLs. |
| `.env.local`, `.vercel/` | Local env and project link. Git-ignored; never copy their contents anywhere. |

Cookie: `mayor_demo`, HttpOnly, Secure, SameSite=Lax, one year, value = HMAC of a fixed string with
`DEMO_COOKIE_SECRET`. Rotating the secret logs out every buyer (they can use restore by email).

## Environment variables (Vercel, Production scope)

| Name | Use |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe live secret key (account "FlowDesk") |
| `STRIPE_PRICE_ID` | Price of the "Mayor — Web Demo" product ($4.99 one-time) |
| `DEMO_COOKIE_SECRET` | HMAC secret for the access cookie |

Preview deployments do not have these (checkout there answers "Payments not configured yet."). Manage with
`npx vercel env ls` / `npx vercel env add <NAME> production` from `~/mayor-site`; never paste values into docs or
chat logs.

## Stripe settings

- Live mode, account "FlowDesk"; product "Mayor — Web Demo", one-time price $4.99.
- API version `2025-03-31.basil` (pinned in code).
- Product tax code `txcd_10103000` (SaaS, personal use), set on the product in the Dashboard (not in code; not
  re-checked in this pass). Eligible for Stripe Managed Payments (owner's note; not re-checked).
- Refunds: manual, from the Stripe Dashboard. There is no written refund policy yet (see gaps).

## Refresh the game bundle

From this repository, on `main` after `npm run ci` is green:

```bash
npm run build                                   # writes dist/
rsync -a --delete dist/ ~/mayor-site/game/      # replace the bundle (keeps nothing stale)
cd ~/mayor-site && npx vercel deploy            # preview: check the landing page and the gate
cd ~/mayor-site && npx vercel deploy --prod     # production
```

Last refresh: 2026-10-15 from `main` (owner's note; the exact commit was not recorded; record it next time).

## Deploy

- Preview: `npx vercel deploy` from `~/mayor-site` (prints a `mayor-demo-<hash>-...vercel.app` URL).
- Production: `npx vercel deploy --prod`.
- Rollback: Vercel dashboard > Deployments > promote an earlier deployment.

## Test checklist (after every production deploy)

1. `/` loads (200), EN/PT toggle and theme toggle work, slider moves with drag and arrow keys, no horizontal scroll
   at 390 px.
2. `/game/index.html` without the cookie answers a redirect to `/demo`; `/demo` shows the gate.
3. "Get access" opens `checkout.stripe.com` (a live session; do not pay unless testing end to end, then refund).
4. After a real payment: redirect to `/demo?session_id=...`, cookie set, the game loads, a road can be drawn.
5. A second visit opens the game directly (cookie). A private window shows the gate.
6. Restore by email in a private window with the buyer's receipt email (unverified so far, see gaps).
7. `/privacy`, `/privacidade`, `/support`, `/suporte` return 200 (App Store Connect links to them).

## Known gaps

| Gap | Owner / engineering | Note |
|---|---|---|
| Restore by email is unverified end to end | engineering | Needs one real paid session restored from another browser. |
| Possession of the receipt email address is the only proof for restore | owner decision | Anyone who knows a buyer's email can restore access. A magic link (email a one-time URL) would fix it; not built. |
| No magic link | engineering | Needs an email sender (Stripe receipts cannot carry a custom link). |
| Refund policy is a placeholder in the FAQ | owner | Write the real policy and a contact channel. |
| Game bundle refresh is manual and unrecorded | engineering | Record the source commit on every refresh. |
| Preview deployments cannot test checkout | owner | Add the env vars to the Preview scope if wanted. |
| Site source is not versioned | owner decision | Consider a private repo for `~/mayor-site` (excluding `.env*` and `.vercel`). |
