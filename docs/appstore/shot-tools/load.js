(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = (...names) => [...document.querySelectorAll("button")].find((b) => names.includes(b.title) || names.includes(b.getAttribute("aria-label")));
  btn("Menu: save, load, new city", "Menu: salvar, carregar, nova cidade").click();
  await sleep(300);
  document.querySelector('[data-load="2"]').click();
  await sleep(1500);
  btn("Pause", "Pausar")?.click();
  btn("Dismiss the guide", "Dispensar o guia")?.click();
  const s = window.__city.state;
  s.raining = false;
  window.__cam = (x, z, dist, pitch, yaw) => { const r = window.__city.renderer.rig; r.target.set(x, 0, z); r.dist = dist; r.pitch = pitch; r.yaw = yaw; r.apply(); };
  window.__screen = (x, y, z) => { const cam = window.__city.renderer.rig.camera; const v = cam.position.clone().set(x, y, z).project(cam); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; };
  const r = window.__city.renderer.rig;
  return JSON.stringify({ pop: Math.round(s.population), day: s.day, ey: s.world.entry.y, rig: { t: r.target, dist: r.dist, pitch: r.pitch, yaw: r.yaw } });
})()
