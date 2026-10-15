# App Store metadata: English (U.S.)

Paste each fenced block into App Store Connect as is. Limits are checked by
`bash scripts/appstore-prereq-check.sh` (it counts the text inside each ```text block; the
limit is the number in the heading). Secondary localization; the primary language is pt-BR
(`metadata.pt-BR.md`).

## Name (limit 30)

```text
Mayor: City Builder
```

## Subtitle (limit 30)

```text
Plan roads, zones and services
```

## Promotional text (limit 170)

```text
Draw curved streets and avenues, zone homes, shops and industry, and keep power, water and services ahead of a growing city. Fully offline, no ads, no accounts.
```

## Description (limit 4000)

```text
Mayor is a city builder for iPad. Start on an empty landscape with a single highway entry and grow a living city one street at a time.

DRAW REAL ROADS
Lay streets, avenues, one-way roads and highways with straight and curved tools. Junctions, crossings, roundabouts, bridges, tunnels and interchanges are built for you, with traffic lights, crosswalks and kerbs that follow the shape of every road.

ZONE AND WATCH IT GROW
Paint residential, commercial and industrial zones along your streets. Lots follow the road, buildings rise through construction phases, and neighbourhoods densify from houses to row houses to towers as land value and services improve.

KEEP THE CITY RUNNING
Power plants, solar farms, water towers, pumps and sewage outlets feed networks that run along your roads. Police, fire, clinics, hospitals, schools, libraries, parks and a city hall each cover an area, and every facility shows how many buildings, residents and jobs it serves.

TRAFFIC AND TRANSIT
Cars follow lanes, signals and turn rules. Watch congestion in the traffic view, then fix it with avenues, roundabouts, bus lines, metro and trains.

READ YOUR CITY
Info views for every service, land value and traffic. Demand bars tell you what to zone next. The budget, tax rate and city statistics show whether your plan works.

MADE FOR IPAD
Touch-first controls: drag to draw, pinch to zoom, twist to rotate. Day and night cycle, weather and graphics settings tuned for iPad.

PLAY ANYWHERE
Mayor runs completely offline. There are no ads, no accounts, no in-app purchases and no data collection. Cities are saved on your iPad, with three save slots and a monthly autosave.

Available in Portuguese (Brazil) and English.

Mayor is an original game inspired by classic city builders. It is not affiliated with or endorsed by any other game publisher.
```

## Keywords (limit 100)

```text
city,builder,simulation,urban,planning,traffic,zoning,town,roads,transit,strategy,offline,tycoon
```

## Support URL

```text
https://mayor-demo.vercel.app/support
```

OWNER: the page must exist and show a way to contact you (email or form) before review. If you
prefer, use a GitHub issues page or a simple contact page on the same host.

## Marketing URL (optional)

```text
https://github.com/wsgutnik/mayor
```

Entered in App Store Connect on 2026-10-15 (the public repository; the first draft pointed at the demo site, which
sells the web demo through Stripe, see review risk 12).

## Privacy Policy URL (required)

```text
https://mayor-demo.vercel.app/privacy
```

Host the English policy from `privacy.md` there (and the pt-BR one, for example at `/privacidade`).

## Copyright

```text
2026 Willian Gutnik
```

## Category

- Primary: Games, subcategory Simulation
- Secondary: Games, subcategory Strategy

## Age rating questionnaire

Answer **None / No** to every content descriptor; expected result **4+**.

| Question | Answer |
|---|---|
| Cartoon or fantasy violence | None |
| Realistic violence | None |
| Prolonged graphic or sadistic realistic violence | None |
| Profanity or crude humor | None |
| Mature or suggestive themes | None |
| Horror or fear themes | None |
| Medical or treatment information | None (hospitals and clinics are city buildings only) |
| Alcohol, tobacco, or drug use or references | None |
| Simulated gambling | None |
| Sexual content or nudity | None |
| Graphic sexual content and nudity | None |
| Contests | None |
| Unrestricted web access | No (the app has no browser and loads no web pages) |
| User-generated content / messaging / chat | No |
| In-app purchases, loot boxes | No |
| Advertising | No |
| Age assurance / parental controls | Not applicable |

Notes for the owner: the game is fictional; fires can destroy a building (a notification, no
people shown). The public web demo paywall (Vercel/Stripe) is **not** part of the iPad app: the
app contains no purchase flow, link or reference to the paywall.

## What's New in this version (limit 4000)

```text
First release on the App Store: draw roads with curves, roundabouts, bridges and tunnels; zone a growing city; run power, water, sewage and public services; manage traffic and transit; play fully offline in Portuguese or English.
```

## App Review contact and notes

See `review-notes.md` (paste the "Notes" block into App Review Information; no demo account is
needed because the app has no login).
