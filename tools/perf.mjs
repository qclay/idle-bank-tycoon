// Замер: чем рисует браузер, сколько времени занимает наш JS в кадре и какой FPS.
import { chromium } from 'playwright';
const URL = process.env.SHOT_URL || 'http://localhost:8199/index.html';
const args = process.env.GPU ? [] : ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'];
const b = await chromium.launch({ args });
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
await p.goto(URL);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.evaluate(() => {
  const { S, actors } = window.__game;
  S.cash = 5e8; S.gold = 900;
  for (const id of ['c1','c2','c3','c4','c5','c6']) { S.counters[id].open = true; S.counters[id].lvl = 20; S.counters[id].clerk = 4; }
  S.atms.a1.open = true; S.atms.a2.open = true; S.runner = 5;
  actors.refreshSolids(); actors.syncStaff();
});
await p.waitForTimeout(4000);

const info = await p.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return {
    gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'нет данных',
    customers: window.__game.actors.customers.length,
  };
});

const r = await p.evaluate(() => new Promise((res) => {
  window.__prof = { total: 0, sim: 0, draw: 0, ui: 0, n: 0 };
  let n = 0; const t0 = performance.now();
  const tick = () => {
    n++;
    if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
    else {
      const P = window.__prof;
      res({ fps: n / ((performance.now() - t0) / 1000),
            sim: P.sim / Math.max(1, P.n), draw: P.draw / Math.max(1, P.n), ui: P.ui / Math.max(1, P.n) });
      window.__prof = null;
    }
  };
  requestAnimationFrame(tick);
}));

console.log('рендерер:', info.gpu);
console.log('клиентов в зале:', info.customers);
console.log('FPS:', r.fps.toFixed(1));
console.log(`наш JS в кадре: симуляция ${r.sim.toFixed(2)} мс, сцена ${r.draw.toFixed(2)} мс, интерфейс ${r.ui.toFixed(2)} мс`);
await b.close();
