(async () => {
  const sim = await import("/src/sim/sim.ts");
  const s = window.__city.state, w = s.world;
  let seed = 777, n = 0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const lot of w.olots ?? []) if (lot.level === 0 && !lot.landmark) { sim.setOLotLevel(w, lot, rnd() < 0.6 ? 1 : 2); n++; }
  w.revision++; sim.syncLots(s);
  const lv = [0, 0, 0, 0, 0, 0];
  for (const l of w.olots ?? []) lv[l.level]++;
  return JSON.stringify({ n, lv });
})()
