(async () => {
  const sim = await import("/src/sim/sim.ts");
  const W = await import("/src/sim/world.ts");
  const s = window.__city.state, w = s.world;
  const ey = w.entry.y;
  s.money = 5e6;
  const log = [];
  const road = (type, x0, y0, x1, y1) => { const r = sim.placeRoad(s, type, [{ x: x0 + 0.5, z: y0 + 0.5 }, { x: x1 + 0.5, z: y1 + 0.5 }]); log.push(`road ${x0},${y0}-${x1},${y1} ${r.ok ? "ok" : r.reason}`); return r.ok; };
  // shoreline road south of the grid
  const sy = ey + 25;
  road(1, 16, sy, 46, sy);
  const place = (tool, px, py, rad = 5) => {
    for (let r = 0; r <= rad; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (sim.applyTool(s, tool, px + dx, py + dy).ok) return `${tool}@${px + dx},${py + dy}`;
    }
    return `${tool} FAILED near ${px},${py}`;
  };
  for (let x = 14; x <= 50; x += 4) log.push(place("waterlarge", x, sy + 2, 3));
  for (let x = 16; x <= 48; x += 8) log.push(place("sewage", x, sy + 3, 3));
  log.push(place("powerlarge", 60, ey + 13)); log.push(place("powerlarge", 2, ey + 8));
  log.push(place("landfill", 60, ey - 10)); log.push(place("landfill", 3, ey + 13)); log.push(place("landfill", 44, ey + 20)); log.push(place("landfill", 20, ey + 20));
  log.push(place("park", 30, ey + 12)); log.push(place("park", 14, ey - 3)); log.push(place("park", 52, ey - 3)); log.push(place("firehq", 40, ey + 20)); log.push(place("firepost", 52, ey + 6));
  log.push(place("busstop", 16, ey)); log.push(place("busstop", 44, ey));
  for (let d = 0; d < (window.__GROW ?? 60); d++) { if (s.money < 1e6) s.money = 5e6; sim.step(s); }
  s.raining = false;
  sim.syncLots(s);
  const lv = [0, 0, 0, 0, 0, 0];
  for (const l of w.olots ?? []) lv[l.level]++;
  return JSON.stringify({ log, lv, pop: Math.round(s.population), util: s.utilities, happy: s.happiness, cov: s.coverage });
})()
