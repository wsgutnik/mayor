(async () => {
  const sim = await import("/src/sim/sim.ts");
  const s = window.__city.state, w = s.world;
  const ey = w.entry.y;
  s.money = 5e6;
  const rect = (x0, y0, x1, y1) => { const t = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) t.push({ x, y }); return t; };
  const place = (tool, px, py, rad = 6) => {
    for (let r = 0; r <= rad; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (sim.applyTool(s, tool, px + dx, py + dy).ok) return `${tool}@${px + dx},${py + dy}`;
    }
    return `${tool} FAILED`;
  };
  const log = [];
  for (const [x, y] of [[2, ey + 18], [64, ey + 10], [64, ey - 12], [14, ey + 22], [36, ey + 22], [58, ey + 22]]) log.push(place("watertower", x, y));
  log.push(place("waterlarge", 22, ey + 28, 4)); log.push(place("waterlarge", 40, ey + 28, 4));
  sim.applyZoneBulk(s, "res", [...rect(27, ey + 10, 35, ey + 17), ...rect(47, ey + 10, 55, ey + 17)]);
  sim.applyZoneBulk(s, "com", rect(36, ey + 4, 45, ey + 8));
  sim.syncLots(s);
  let seed = 777;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const lot of w.olots ?? []) if (lot.level === 0 && !lot.landmark) sim.setOLotLevel(w, lot, rnd() < 0.6 ? 1 : 2);
  w.revision++; sim.syncLots(s); sim.step(s); s.raining = false; sim.syncLots(s);
  const lv = [0, 0, 0, 0, 0, 0];
  for (const l of w.olots ?? []) lv[l.level]++;
  const st = await import("/src/storage.ts");
  st.saveTo("2", s);
  return JSON.stringify({ log, lv, pop: Math.round(s.population), util: s.utilities });
})()
