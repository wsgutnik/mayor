(async () => {
  const W = await import("/src/sim/world.ts");
  const s = window.__city.state, w = s.world;
  const names = Object.fromEntries(Object.entries(W.FAC).map(([k, v]) => [v, k]));
  const r = window.__city.renderer;
  const hits = {};
  for (let y = 120; y < innerHeight - 120; y += 12) for (let x = 40; x < innerWidth - 340; x += 12) {
    const t = r.pick(x, y);
    if (!t) continue;
    const f = w.facility[W.idx(w, t.x, t.y)];
    if (f) (hits[names[f]] ??= []).push([x, y, t.x, t.y]);
  }
  const out = {};
  for (const [k, v] of Object.entries(hits)) { const m = v[Math.floor(v.length / 2)]; out[k] = { n: v.length, at: m }; }
  return JSON.stringify(out);
})()
