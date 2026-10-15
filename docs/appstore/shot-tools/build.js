(async () => {
  const sim = await import("/src/sim/sim.ts");
  const W = await import("/src/sim/world.ts");
  [...document.querySelectorAll("button")].find((b) => b.title === "Menu: save, load, new city").click();
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector("#menu-seed").value = String(window.__SEED ?? 30);
  document.querySelector("[data-new]").click();
  await new Promise((r) => setTimeout(r, 1500));
  const s = window.__city.state;
  const w = s.world;
  s.money = 5e6;
  const ey = w.entry.y;
  const log = [];
  const road = (type, x0, y0, x1, y1) => {
    const r = sim.placeRoad(s, type, [{ x: x0 + 0.5, z: y0 + 0.5 }, { x: x1 + 0.5, z: y1 + 0.5 }]);
    if (!r.ok) log.push(`road ${x0},${y0}-${x1},${y1}: ${r.reason}`);
    return r.ok;
  };
  const X0 = 6, X1 = 62, rows = (window.__ROWS ?? [-16, -8, 0, 9, 18]).map((d) => ey + d), cols = [6, 16, 26, 36, 46, 56];
  road(1, 2, ey, X0, ey);
  for (const y of rows) road(y === ey ? 2 : 1, X0, y, X1, y);
  for (const x of cols) road(x === 26 ? 2 : 1, x, rows[0], x, rows[4]);
  const rect = (x0, y0, x1, y1) => { const t = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) t.push({ x, y }); return t; };
  // services: search near a preferred spot until placement succeeds
  const place = (tool, px, py, rad = 14) => {
    for (let r = 0; r <= rad; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const res = sim.applyTool(s, tool, px + dx, py + dy);
      if (res.ok) return `${tool}@${px + dx},${py + dy}`;
    }
    return `${tool} FAILED`;
  };
  // find water near the grid for pump/sewage
  let wpt = null;
  for (let r = 2; r < 48 && !wpt; r++) for (let x = X0; x <= X1 && !wpt; x++) for (const y of [rows[0] - r, rows[4] + r]) {
    if (W.inBounds(w, x, y) && !W.isLand(w, x, y)) { wpt = { x, y }; break; }
  }
  log.push(`water ${JSON.stringify(wpt)}`);
  if (wpt) road(1, wpt.x, rows[4], wpt.x, wpt.y - 4);
  log.push(place("powerlarge", 58, ey + 4)); log.push(place("powerlarge", 51, ey + 4)); log.push(place("powerlarge", 58, ey - 5)); log.push(place("solar", 51, ey - 5)); log.push(place("powerlarge", 9, ey - 5)); log.push(place("powerlarge", 9, ey + 15)); log.push(place("powerlarge", 33, ey + 15)); log.push(place("watertower", 22, ey + 6)); log.push(place("watertower", 33, ey - 12)); log.push(place("watertower", 46, ey + 6)); log.push(place("watertower", 20, ey - 12));
  log.push(wpt ? place("waterlarge", wpt.x - 2, wpt.y - 2, 6) : "no pump"); log.push(wpt ? place("waterlarge", wpt.x + 3, wpt.y - 2, 6) : "no pump"); log.push(place("watertower", 40, ey + 13)); log.push(place("watertower", 50, ey - 12));
  log.push(wpt ? place("sewage", wpt.x - 5, wpt.y - 1, 6) : "no sewage"); log.push(wpt ? place("sewage", wpt.x + 6, wpt.y - 1, 6) : "no sewage");
  log.push(place("watertower", 12, ey + 5));
  log.push(place("landfill", 59, ey + 14)); log.push(place("landfill", 8, ey - 13)); log.push(place("highschool", 20, ey + 13)); log.push(place("hospital", 40, ey + 5)); log.push(place("firepost", 12, ey + 9)); log.push(place("police", 44, ey - 6)); log.push(place("library", 22, ey - 5));
  log.push(place("police", 20, ey + 4));
  log.push(place("fire", 32, ey - 6));
  log.push(place("clinic", 12, ey - 4));
  log.push(place("school", 12, ey + 13));
  log.push(place("park", 18, ey - 13));
  log.push(place("park", 40, ey - 13));
  log.push(place("cityhall", 31, ey + 6));
  log.push(place("busstop", 30, ey));
  // residential west and north, commercial along the avenues, industry east
  const Z = window.__ZONES ?? { res: [[7, ey - 7, 25, ey - 1], [7, ey + 1, 25, ey + 8]], com: [[27, ey - 3, 45, ey + 3]], ind: [[47, ey + 1, 55, ey + 8]] };
  const zr = sim.applyZoneBulk(s, "res", Z.res.flatMap((r) => rect(...r)));
  const zc = sim.applyZoneBulk(s, "com", Z.com.flatMap((r) => rect(...r)));
  const zi = sim.applyZoneBulk(s, "ind", Z.ind.flatMap((r) => rect(...r)));
  log.push(`zones ${zr.ok}/${zc.ok}/${zi.ok} ${zr.reason ?? ""}${zc.reason ?? ""}${zi.reason ?? ""}`);
  sim.syncLots(s);
  for (let d = 0; d < (window.__DAYS ?? 720); d++) { if (s.money < 1e6) s.money = 5e6; sim.step(s); }
  sim.syncLots(s);
  return JSON.stringify({ log, pop: s.population, day: s.day, lots: (w.olots ?? []).length, built: (w.olots ?? []).filter((l) => l.level > 0).length, money: s.money, util: s.utilities, cov: s.coverage });
})()
