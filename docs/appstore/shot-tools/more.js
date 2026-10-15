(async () => {
  const sim = await import("/src/sim/sim.ts");
  const s = window.__city.state, w = s.world;
  const ey = w.entry.y;
  s.money = 5e6;
  const log = [];
  const place = (tool, px, py, rad = 6) => {
    for (let r = 0; r <= rad; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (sim.applyTool(s, tool, px + dx, py + dy).ok) return `${tool}@${px + dx},${py + dy}`;
    }
    return `${tool} FAILED near ${px},${py}`;
  };
  for (const [x, y] of [[3, ey - 6], [3, ey + 3], [64, ey - 4], [64, ey + 4], [24, ey + 21], [50, ey + 21], [30, ey - 18], [44, ey - 18]]) log.push(place("watertower", x, y));
  for (const [x, y] of [[64, ey + 17], [10, ey + 21], [56, ey + 21], [2, ey - 12]]) log.push(place("landfill", x, y));
  for (let d = 0; d < (window.__GROW ?? 20); d++) { if (s.money < 1e6) s.money = 5e6; sim.step(s); }
  // top up empty lots once supply allows, then one more day for the counters
  for (const lot of w.olots ?? []) if (lot.level === 0 && !lot.landmark) sim.setOLotLevel(w, lot, 1);
  w.revision++; sim.syncLots(s); sim.step(s); s.raining = false; sim.syncLots(s);
  const lv = [0, 0, 0, 0, 0, 0];
  for (const l of w.olots ?? []) lv[l.level]++;
  return JSON.stringify({ log, lv, pop: Math.round(s.population), util: s.utilities, happy: Math.round(s.happiness) });
})()
