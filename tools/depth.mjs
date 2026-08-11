// Порядок отрисовки. Изометрия прощает мало: стоит ошибиться с глубиной, и
// мебель начинает резать героя пополам, а прохожие с улицы — рисоваться поверх
// стены. Проверяем по числам, а не на глаз.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR || '/private/tmp/shots';
const PAGE = process.env.SHOT_URL || 'http://localhost:8199/index.html';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

const checks = [];
const ok = (name, cond, info = '') => checks.push({ name, pass: !!cond, info });

await p.goto(PAGE);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.evaluate(() => {
  const { S, actors } = window.__game;
  S.tut = 99;
  for (const c of Object.values(S.counters)) { c.open = true; c.clerk = 1; }
  for (const a of Object.values(S.atms)) a.open = true;
  for (const z of Object.values(S.zones)) z.open = true;
  actors.refreshSolids(); actors.syncStaff(); window.__rebuild();
});
await p.waitForTimeout(1200);

// ── Слои ─────────────────────────────────────────────────────────────────────

const layers = await p.evaluate(() => window.__game.scene.layers());
ok('внешние стены лежат отдельным слоем за предметами и перед улицей',
   layers.ground < layers.shell && layers.shell < layers.items && layers.items < layers.fx,
   `пол ${layers.ground}, стены ${layers.shell}, предметы ${layers.items}, эффекты ${layers.fx}`);

// ── Стены собраны без щелей ──────────────────────────────────────────────────
// Полосы стены обязаны идти ровно по шагу сетки. Стоит взять их не с той
// стороны картинки — и стена рассыпается на висящие в воздухе куски.

const walls = await p.evaluate(() => {
  const { scene } = window.__game;
  const B = window.__balance;
  const layer = scene.world.children[scene.layers().shell];
  const kind = (c) => (c.children[0]?.texture?.source?.label || '');
  const rows = {};
  for (const c of layer.children) {
    const k = kind(c).includes('wall-front') ? 'front' : kind(c).includes('wall-side') ? 'side' : null;
    if (!k) continue;
    const sp = c.children[0];
    (rows[k] = rows[k] || []).push({ x: sp.x, y: sp.y, ax: sp.anchor.y * sp.height });
  }
  const out = {};
  for (const [k, list] of Object.entries(rows)) {
    list.sort((a, b) => (k === 'front' ? a.x - b.x : b.x - a.x));
    const dx = [], dy = [], base = [];
    for (let i = 1; i < list.length; i++) {
      dx.push(Math.round((list[i].x - list[i - 1].x) * 100) / 100);
      dy.push(Math.round((list[i].y - list[i - 1].y) * 100) / 100);
      base.push(Math.round((list[i].y - list[i].ax) * 100) / 100);
    }
    out[k] = { n: list.length, dx: [...new Set(dx)], dy: [...new Set(dy)] };
  }
  return { out, TW: 76, TH: 38, hall: [B.HALL.w, B.HALL.h] };
});
for (const [k, v] of Object.entries(walls.out)) {
  const stepX = k === 'front' ? walls.TW / 2 : -walls.TW / 2;
  ok(`стена «${k}» идёт ровным шагом без щелей`,
     v.dx.length === 1 && Math.abs(v.dx[0] - stepX) < 0.5
     && v.dy.length === 1 && Math.abs(v.dy[0] - walls.TH / 2) < 0.5,
     `шаг по x ${v.dx.join('/')} (нужен ${stepX}), по y ${v.dy.join('/')} (нужен ${walls.TH / 2})`);
}

// ── Стойка против людей вокруг неё ───────────────────────────────────────────

const counters = await p.evaluate(() => {
  const { scene, actors } = window.__game;
  const B = window.__balance;
  const out = [];
  for (const c of B.COUNTERS) {
    const v = window.__views.counters.get(c.id);
    if (!v) continue;
    const near = v.zIndex;
    const far = v.zIndex;
    const at = (x, y) => (x + y) * 1000;
    const clerk = actors.clerkSpot(c);
    const pick = actors.pickSpot(c);
    const q0 = actors.queueSpot(c, 0);
    const q2 = actors.queueSpot(c, 2);
    out.push({
      id: c.id,
      операторЗа: at(clerk.x, clerk.y) < far,
      сборщикПеред: at(pick.x, pick.y) > far,
      очередьПеред: at(q0.x, q0.y) > near && at(q2.x, q2.y) > near,
    });
    void scene;
  }
  return out;
});
ok('оператор всегда рисуется за своей стойкой',
   counters.every((c) => c.операторЗа), counters.filter((c) => !c.операторЗа).map((c) => c.id).join(', '));
ok('тот, кто забирает выручку, — перед стойкой',
   counters.every((c) => c.сборщикПеред), counters.filter((c) => !c.сборщикПеред).map((c) => c.id).join(', '));
ok('вся очередь рисуется перед стойкой',
   counters.every((c) => c.очередьПеред), counters.filter((c) => !c.очередьПеред).map((c) => c.id).join(', '));

// ── Прочая мебель ────────────────────────────────────────────────────────────

const furniture = await p.evaluate(() => {
  const B = window.__balance;
  const at = (x, y) => (x + y) * 1000;
  const bad = [];
  const test = (name, view, frontX, frontY) => {
    if (!view) return;
    if (at(frontX, frontY) <= view.zIndex) bad.push(name);
  };
  for (const a of B.ATMS) {
    const v = window.__views.atms.get(a.id);
    test(`постамат ${a.id}`, v, a.x + 0.36, a.y + 1.4);
  }
  for (const z of B.ZONES) {
    const v = window.__views.zones.get(z.id);
    test(`зона ${z.id}`, v, z.x + 1.1, z.y + 2.0);
  }
  return bad;
});
ok('перед постаматами и зонами человек рисуется спереди', furniture.length === 0, furniture.join(', '));

// ── Живая сцена: герой у стойки не должен быть разрезан ──────────────────────

const cut = await p.evaluate(() => new Promise((res) => {
  const { actors } = window.__game;
  const B = window.__balance;
  const c = B.COUNTERS[0];
  const sp = actors.pickSpot(c);
  actors.player.x = sp.x; actors.player.y = sp.y;
  setTimeout(() => {
    const v = actors.player.view;
    res({ игрок: v.zIndex, стойка: [window.__views.counters.get(c.id).zIndex] });
  }, 500);
}));
ok('стоя у стойки, герой рисуется поверх неё',
   cut.стойка.every((z) => cut.игрок > z),
   `герой ${cut.игрок}, части стойки ${cut.стойка.join(', ')}`);

await p.screenshot({ path: `${OUT}/depth.png` });
ok('страница работает без ошибок', errs.length === 0, errs.slice(0, 3).join(' | '));

for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.info ? '  — ' + c.info : ''}`);
const bad = checks.filter((c) => !c.pass).length;
console.log(`\nпройдено ${checks.length - bad} из ${checks.length}`);
await b.close();
process.exit(bad ? 1 : 0);
