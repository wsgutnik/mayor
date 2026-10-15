(async () => {
  const sim = await import("/src/sim/sim.ts");
  const s = window.__city.state, w = s.world;
  const ey = w.entry.y;
  const rect = (x0, y0, x1, y1) => { const t = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) t.push({ x, y }); return t; };
  s.money = Math.max(s.money, 2e6);
  sim.applyZoneBulk(s, "res", [...rect(7, ey + 10, 25, ey + 17), ...rect(37, ey + 10, 45, ey + 17), ...rect(47, ey - 7, 62, ey - 1)]);
  sim.applyZoneBulk(s, "com", [...rect(27, ey + 4, 35, ey + 8), ...rect(27, ey - 7, 35, ey - 4)]);
  sim.applyZoneBulk(s, "ind", rect(56, ey + 1, 62, ey + 8));
  sim.syncLots(s);
  // deterministic pseudo-random levels: a believable mix, denser near the avenue crossing
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let staged = 0;
  for (const lot of w.olots ?? []) {
    if (lot.landmark) continue;
    const near = Math.hypot(lot.cx - 26, lot.cz - ey) < 12;
    const max = lot.zone === 3 ? 2 : near ? 3 : 2;
    const lvl = Math.min(max, 1 + Math.floor(rnd() * (near ? 3 : 2.2)));
    if (lot.level < lvl) { sim.setOLotLevel(w, lot, lvl); staged++; }
  }
  w.revision++;
  sim.syncLots(s);
  sim.step(s);
  s.raining = false;
  const lv = [0, 0, 0, 0, 0, 0];
  for (const l of w.olots ?? []) lv[l.level]++;
  // pause, dismiss guide and toasts
  for (const b of document.querySelectorAll("button")) {
    const t = b.title || b.getAttribute("aria-label") || "";
    if (t === "Pause" || t === "Dismiss the guide" || t === "Pausar" || t === "Dispensar o guia") b.click();
  }
  document.querySelectorAll(".toast button, [aria-label='Dismiss'], [aria-label='Dispensar']").forEach((b) => b.click());
  return JSON.stringify({ staged, lv, pop: Math.round(s.population), lots: (w.olots ?? []).length });
})()
