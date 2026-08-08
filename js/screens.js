// Окна игры. Структура и стили — из вольера фермы; иконки только картинками.

import { fmt, dur, clock, plural } from './core.js';
import {
  COUNTERS, ATMS, STAFF, BOOSTS, SAFES, SHOP_GOLD, ACHIEVEMENTS, DAILY_POOL,
  DAILY_ALL, OFFLINE, UPGRADES,
} from './balance.js';
import { S, save, emit } from './state.js';
import {
  counterPay, counterUpCost, upgradeCounter, atmRate, atmUpCost, upgradeAtm,
  clerkCost, clerkSpeed, hireClerk, runnerCost, hireRunner, boostLeft, boostOn,
  shownIncome, offlineUpCost, offlineCapSec, autoIncome,
} from './game.js';
import { toast, haptic, setNav, setBadge } from './ui.js';

const COIN = './assets/ui/coin.png';
const STAR = './assets/ui/hud_star.png';

const root = () => document.getElementById('winRoot');
let cur = null;          // { el, render }

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ── Каркас окна ──────────────────────────────────────────────────────────────

function open({ title, tabs, render, cap }) {
  close(true);
  const el = document.createElement('div');
  el.className = 'win' + (tabs ? ' win--tabs' : ' win--plain') + (cap ? '' : ' win--nocap');
  el.innerHTML = `
    <div class="win__wrap">
      <div class="win__body">
        <div class="win__head"><b>${esc(title)}</b></div>
        <button class="win__close"><img src="./assets/pen/close.png" alt=""></button>
        ${tabs ? `<div class="win__tabs">${tabs.map((t, i) => `
          <button class="win__tab${i === 0 ? ' is-on' : ''}" data-i="${i}">
            <img src="./assets/orders/${i === 0 ? 'tab_active' : 'tab_done'}.png" alt="">
            <b>${esc(t.label)}</b></button>`).join('')}</div>` : ''}
        <div class="win__panel"><div class="win__scroll"></div></div>
        ${cap ? '<div class="win__cap"></div>' : ''}
      </div>
    </div>`;
  root().appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-open'));

  const scroll = el.querySelector('.win__scroll');
  const capEl = el.querySelector('.win__cap');
  let tabIdx = 0;

  const paint = () => {
    const y = scroll.scrollTop;
    scroll.innerHTML = '';
    const body = tabs ? tabs[tabIdx].render() : render();
    if (typeof body === 'string') scroll.innerHTML = body; else scroll.appendChild(body);
    scroll.scrollTop = y;
    if (capEl && cap) {
      capEl.innerHTML = '';
      const c = cap();
      if (typeof c === 'string') capEl.innerHTML = c;
      else if (c) while (c.firstChild) capEl.appendChild(c.firstChild);
    }
  };

  el.querySelector('.win__close').addEventListener('click', () => close());
  el.addEventListener('click', (e) => { if (e.target === el || e.target.classList.contains('win__wrap')) close(); });

  if (tabs) {
    el.querySelectorAll('.win__tab').forEach((b) => b.addEventListener('click', () => {
      tabIdx = Number(b.dataset.i);
      el.querySelectorAll('.win__tab').forEach((x, i) => {
        x.classList.toggle('is-on', i === tabIdx);
        x.querySelector('img').src = `./assets/orders/${i === tabIdx ? 'tab_active' : 'tab_done'}.png`;
      });
      scroll.scrollTop = 0;
      paint();
    }));
  }

  cur = { el, paint };
  paint();
  return cur;
}

export function close(silent = false) {
  if (!cur) return;
  const { el } = cur;
  el.classList.remove('is-open');
  setTimeout(() => el.remove(), 200);
  cur = null;
  if (!silent) setNav('bank');
}

export function refresh() { cur?.paint(); }
export function isOpen() { return !!cur; }

// ── Кнопки ───────────────────────────────────────────────────────────────────

function btn(cls, title, price, icon = COIN, disabled = false) {
  return `<button class="btn ${cls}"${disabled ? ' disabled' : ''}>
    <span class="btn__t">${esc(title)}</span>
    ${price != null ? `<span class="btn__p"><img src="${icon}" alt="">${price}</span>` : ''}
  </button>`;
}

const h = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d; };

// ── ПЕРСОНАЛ ─────────────────────────────────────────────────────────────────

export function staff() {
  setNav('staff');
  open({
    title: 'Персонал',
    render: staffView,
    cap: () => {
      const cost = runnerCost();
      const lvl = S.runner;
      const maxed = lvl >= STAFF.runner.maxLvl;
      const el = h(`
        <img class="win__cap-ico" src="${STAFF.runner.art}" alt="">
        <div class="win__cap-txt">
          <div class="win__cap-t1">Инкассатор ${lvl ? `<b>ур. ${lvl}</b>` : ''}</div>
          <div class="win__cap-t2">${lvl ? 'Сам относит выручку в хранилище' : 'Некому носить выручку — берите сами'}</div>
        </div>
        ${btn('btn--cap', maxed ? 'Максимум' : lvl ? 'Улучшить' : 'Нанять',
              maxed ? null : fmt(cost), COIN, maxed || S.cash < cost)}`);
      const b = el.querySelector('button');
      if (!maxed && S.cash >= cost) b.addEventListener('click', () => {
        if (hireRunner()) { haptic('success'); toast('Инкассатор вышел на смену'); refresh(); }
      });
      return el;
    },
  });
}

function staffView() {
  const wrap = document.createElement('div');
  const list = document.createElement('div');
  list.className = 'list';

  for (const c of COUNTERS) {
    const st = S.counters[c.id];
    if (!st.open) continue;
    const upC = counterUpCost(c);
    const hireC = clerkCost(c);
    const maxed = st.clerk >= STAFF.clerk.maxLvl;
    const row = h(`<div class="row row--two">
      <div class="row__art"><img src="./assets/char/se_0.png" alt=""></div>
      <div class="row__name">${esc(c.name)} <span class="lvlpill">ур. ${st.lvl}</span></div>
      <div class="row__stat"><img src="${COIN}" alt="">
        ${fmt(counterPay(c))} <span class="arr">→</span> <span class="nx">${fmt(counterPay(c) * 1.14)}</span></div>
      <div class="row__stat">Кассир: ${st.clerk ? `ур. ${st.clerk}` : 'нет'}${st.clerk ? ` · ×${clerkSpeed(c).toFixed(2)}` : ''}</div>
      ${btn('btn--green btn--a', 'Улучшить', fmt(upC), COIN, S.cash < upC)}
      ${btn('btn--blue btn--b', maxed ? 'Максимум' : st.clerk ? 'Кассир +' : 'Кассир', maxed ? null : fmt(hireC), COIN, maxed || S.cash < hireC)}
    </div>`).firstElementChild;
    const [bUp, bHire] = row.querySelectorAll('button');
    if (S.cash >= upC) bUp.addEventListener('click', () => {
      if (upgradeCounter(c)) { haptic(); refresh(); }
    });
    if (!maxed && S.cash >= hireC) bHire.addEventListener('click', () => {
      if (hireClerk(c)) { haptic('success'); toast(`${c.name}: кассир нанят`); refresh(); }
    });
    list.appendChild(row);
  }

  for (const a of ATMS) {
    const st = S.atms[a.id];
    if (!st.open) continue;
    const upC = atmUpCost(a);
    const row = h(`<div class="row row--btn">
      <div class="row__art"><img src="./assets/ui/iphone_blue.png" alt=""></div>
      <div class="row__name">${esc(a.name)} <span class="lvlpill">ур. ${st.lvl}</span></div>
      <div class="row__stat"><img src="${COIN}" alt="">${fmt(atmRate(a))} / сек</div>
      ${btn('btn--green btn--row', 'Улучшить', fmt(upC), COIN, S.cash < upC)}
    </div>`).firstElementChild;
    if (S.cash >= upC) row.querySelector('button').addEventListener('click', () => {
      if (upgradeAtm(a)) { haptic(); refresh(); }
    });
    list.appendChild(row);
  }

  if (!list.children.length) list.innerHTML = '<div class="empty">Откройте первую стойку в зале</div>';
  wrap.appendChild(list);
  return wrap;
}

// ── ЗАДАНИЯ ──────────────────────────────────────────────────────────────────

export function tasks() {
  setNav('tasks');
  open({
    title: 'Задания',
    tabs: [
      { label: 'На день', render: dailyView },
      { label: 'Награды', render: achvView },
    ],
  });
}

function dailyDef(id) { return DAILY_POOL.find((d) => d.id === id); }
export function dailyProgress(t) {
  const d = dailyDef(t.id);
  return Math.floor(S.daily.counters?.[d.stat] || 0);
}
export function dailyReady(t) {
  const d = dailyDef(t.id);
  return !t.done && dailyProgress(t) >= d.goal;
}

function dailyView() {
  const wrap = document.createElement('div');
  const list = document.createElement('div');
  list.className = 'list';
  for (const t of S.daily.tasks) {
    const d = dailyDef(t.id);
    if (!d) continue;
    const cur = Math.min(dailyProgress(t), d.goal);
    const ready = dailyReady(t);
    const row = h(`<div class="row row--btn">
      <div class="row__art"><img src="./assets/tasks/xp.png" alt=""></div>
      <div class="row__name">${esc(d.title)}</div>
      <div class="row__stat">${cur} / ${d.goal}</div>
      <div class="bar"><i style="width:${(cur / d.goal) * 100}%"></i></div>
      ${btn(ready ? 'btn--gold btn--row' : 'btn--green btn--row', t.done ? 'Готово' : 'Забрать',
            t.done ? null : String(d.gold), STAR, !ready)}
    </div>`).firstElementChild;
    if (ready) row.querySelector('button').addEventListener('click', () => {
      t.done = true; S.gold += d.gold;
      haptic('success'); toast(`+${d.gold}`); emit('task'); save(); refresh();
    });
    list.appendChild(row);
  }
  const all = S.daily.tasks.length && S.daily.tasks.every((t) => t.done);
  const bonus = h(`<div class="row row--btn">
    <div class="row__art"><img src="./assets/tasks/chest2.png" alt=""></div>
    <div class="row__name">Все задания дня</div>
    <div class="row__stat">${S.daily.tasks.filter((t) => t.done).length} / ${S.daily.tasks.length}</div>
    ${btn(all && !S.daily.allDone ? 'btn--gold btn--row' : 'btn--green btn--row',
          S.daily.allDone ? 'Готово' : 'Забрать', S.daily.allDone ? null : String(DAILY_ALL.gold), STAR,
          !all || S.daily.allDone)}
  </div>`).firstElementChild;
  if (all && !S.daily.allDone) bonus.querySelector('button').addEventListener('click', () => {
    S.daily.allDone = true; S.gold += DAILY_ALL.gold;
    haptic('success'); toast(`+${DAILY_ALL.gold}`); emit('task'); save(); refresh();
  });
  list.appendChild(bonus);
  wrap.appendChild(list);
  return wrap;
}

export function achvState(a) {
  const tier = S.achv[a.id] || 0;
  const maxed = tier >= a.tiers.length;
  const goal = maxed ? a.tiers[a.tiers.length - 1] : a.tiers[tier];
  const cur = S.stats[a.stat] || 0;
  return { tier, maxed, goal, cur, ready: !maxed && cur >= goal, gold: maxed ? 0 : a.gold[tier] };
}

function achvView() {
  const wrap = document.createElement('div');
  const list = document.createElement('div');
  list.className = 'list';
  for (const a of ACHIEVEMENTS) {
    const st = achvState(a);
    const val = a.money ? fmt : (n) => fmt(Math.floor(n));
    const row = h(`<div class="row row--btn">
      <div class="row__art"><img src="./assets/tasks/${st.maxed ? 'chest3' : 'chest1'}.png" alt=""></div>
      <div class="row__name">${esc(a.title)} <span class="lvlpill">${Math.min(st.tier + 1, a.tiers.length)}/${a.tiers.length}</span></div>
      <div class="row__stat">${val(Math.min(st.cur, st.goal))} / ${val(st.goal)}</div>
      <div class="bar bar--gold"><i style="width:${Math.min(100, (st.cur / st.goal) * 100)}%"></i></div>
      ${btn(st.ready ? 'btn--gold btn--row' : 'btn--green btn--row', st.maxed ? 'Всё' : 'Забрать',
            st.maxed ? null : String(st.gold), STAR, !st.ready)}
    </div>`).firstElementChild;
    if (st.ready) row.querySelector('button').addEventListener('click', () => {
      S.achv[a.id] = st.tier + 1; S.gold += st.gold;
      haptic('success'); toast(`+${st.gold}`); emit('task'); save(); refresh();
    });
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

// ── СЕЙФЫ ────────────────────────────────────────────────────────────────────

export function safeReady() { return Date.now() >= (S.safe.freeAt || 0); }
export function safeLeft() { return Math.max(0, ((S.safe.freeAt || 0) - Date.now()) / 1000); }

export function safes() {
  setNav('safes');
  open({ title: 'Сейфы', render: safesView });
}

function hourCash(h) {
  const inc = shownIncome();
  return Math.max(inc, 4) * 3600 * h;
}

function safesView() {
  const wrap = document.createElement('div');
  const grid = document.createElement('div');
  grid.className = 'grid3';
  for (const s of Object.values(SAFES)) {
    const ready = s.cd ? safeReady() : S.gold >= s.gold;
    const card = h(`<div class="card">
      <div class="card__title">${esc(s.name)}</div>
      <div class="card__art"><img src="${s.art}" alt=""></div>
      <div class="card__gives"><b>${fmt(hourCash(s.cashMin))}</b>–${fmt(hourCash(s.cashMax))}</div>
      ${s.cd
        ? (ready ? btn('btn--green btn--card', 'Открыть', null) : `<div class="lock btn--card">${clock(safeLeft())}</div>`)
        : btn('btn--gold btn--card', 'Открыть', String(s.gold), STAR, !ready)}
    </div>`).firstElementChild;
    const b = card.querySelector('button');
    if (b && ready) b.addEventListener('click', () => {
      const loot = openSafe(s);
      if (loot) { haptic('success'); toast(`+${fmt(loot.cash)} и +${loot.gold}`); refresh(); }
    });
    grid.appendChild(card);
  }
  wrap.appendChild(grid);

  wrap.appendChild(h('<div class="sect">Бусты</div>').firstElementChild);
  const list = document.createElement('div');
  list.className = 'list';
  for (const b of Object.values(BOOSTS)) {
    const on = boostLeft(b.id);
    const freeIn = Math.max(0, ((S.freeBoost[b.id] || 0) - Date.now()) / 1000);
    const row = h(`<div class="row row--two">
      <div class="row__art"><img src="${b.art}" alt=""></div>
      <div class="row__name">${esc(b.name)}${on ? ` <span class="lvlpill">${clock(on)}</span>` : ''}</div>
      <div class="row__stat">${esc(b.desc)}</div>
      ${freeIn > 0
        ? `<div class="lock btn--a" style="height:calc(40 * var(--du))">${clock(freeIn)}</div>`
        : btn('btn--green btn--a', 'Бесплатно', null)}
      ${btn('btn--gold btn--b', 'Купить', String(b.gold), STAR, S.gold < b.gold)}
    </div>`).firstElementChild;
    const bs = row.querySelectorAll('button');
    const freeBtn = freeIn > 0 ? null : bs[0];
    const goldBtn = bs[bs.length - 1];
    freeBtn?.addEventListener('click', () => {
      S.freeBoost[b.id] = Date.now() + b.freeCd * 1000;
      startBoost(b.id); haptic('success'); toast(`${b.name} включён`); refresh();
    });
    if (S.gold >= b.gold) goldBtn.addEventListener('click', () => {
      S.gold -= b.gold; startBoost(b.id); haptic('success'); toast(`${b.name} включён`); refresh();
    });
    list.appendChild(row);
  }
  wrap.appendChild(list);

  wrap.appendChild(h('<div class="sect">Оффлайн</div>').firstElementChild);
  const cap = offlineCapSec() / 3600;
  const cost = offlineUpCost();
  const off = h(`<div class="row row--btn">
    <div class="row__art"><img src="./assets/ui/box_energy.png" alt=""></div>
    <div class="row__name">Копится ${cap} ${plural(cap, 'час', 'часа', 'часов')}</div>
    <div class="row__stat"><img src="${COIN}" alt="">${fmt(autoIncome())} / сек без вас</div>
    ${btn('btn--gold btn--row', cap >= OFFLINE.maxCapHours ? 'Максимум' : 'Больше',
          cap >= OFFLINE.maxCapHours ? null : String(cost), STAR,
          cap >= OFFLINE.maxCapHours || S.gold < cost)}
  </div>`).firstElementChild;
  if (cap < OFFLINE.maxCapHours && S.gold >= cost) off.querySelector('button').addEventListener('click', () => {
    S.gold -= cost; S.offlineUps++; haptic('success'); save(); refresh();
  });
  wrap.appendChild(off);
  return wrap;
}

export function startBoost(id) {
  const d = BOOSTS[id];
  const now = Date.now();
  const cur = S.boosts[id];
  const from = cur && cur.until > now ? cur.until : now;
  S.boosts[id] = { until: from + d.dur * 1000 };
  S.stats.boosts++;
  if (!S.daily.counters) S.daily.counters = {};
  S.daily.counters.boosts = (S.daily.counters.boosts || 0) + 1;
  emit('boost'); save();
}

function openSafe(s) {
  if (s.cd) {
    if (!safeReady()) return null;
    S.safe.freeAt = Date.now() + s.cd * 1000;
  } else {
    if (S.gold < s.gold) return null;
    S.gold -= s.gold;
  }
  const cash = hourCash(s.cashMin + Math.random() * (s.cashMax - s.cashMin));
  const gold = Math.round(s.goldMin + Math.random() * (s.goldMax - s.goldMin));
  S.cash += cash; S.gold += gold;
  S.stats.safes++;
  if (!S.daily.counters) S.daily.counters = {};
  S.daily.counters.safes = (S.daily.counters.safes || 0) + 1;
  emit('safe'); save();
  return { cash, gold };
}

// ── МАГАЗИН ──────────────────────────────────────────────────────────────────

export function shop() {
  setNav('shop');
  open({ title: 'Магазин', render: shopView });
}

function shopView() {
  const wrap = document.createElement('div');
  const grid = document.createElement('div');
  grid.className = 'grid3';
  for (const p of SHOP_GOLD) {
    const card = h(`<div class="card">
      <div class="card__title">${p.tag || '&nbsp;'}</div>
      <div class="card__art"><img src="${p.art}" alt=""></div>
      <div class="card__gives"><b>${fmt(p.gold)}</b></div>
      ${btn('btn--blue btn--card', 'Купить', String(p.stars), STAR)}
    </div>`).firstElementChild;
    card.querySelector('button').addEventListener('click', () => {
      window.__pay({ id: p.id, stars: p.stars, title: `${p.gold} золота`, give: { gold: p.gold } });
    });
    grid.appendChild(card);
  }
  wrap.appendChild(grid);
  wrap.appendChild(h(`<div class="empty">Оплата — звёздами Telegram</div>`).firstElementChild);
  return wrap;
}

// ── ОФФЛАЙН ──────────────────────────────────────────────────────────────────

export function offline(p, onTake) {
  open({
    title: 'Пока вас нет',
    render: () => h(`<div class="card" style="text-align:center;padding:calc(16 * var(--du))">
        <div class="card__art" style="width:auto;height:calc(96 * var(--du))">
          <img src="./assets/ui/box_energy.png" alt=""></div>
        <div class="row__name" style="justify-content:center;font-size:calc(18 * var(--du))">
          <img src="${COIN}" style="width:calc(22 * var(--du));height:calc(22 * var(--du))" alt="">
          ${fmt(p.amount)}</div>
        <div class="row__stat" style="justify-content:center">За ${dur(p.seconds)}</div>
      </div>`),
    cap: () => {
      const el = h(`
        <img class="win__cap-ico" src="./assets/ui/hud_coin.png" alt="">
        <div class="win__cap-txt">
          <div class="win__cap-t1">Банк работал</div>
          <div class="win__cap-t2">${p.capped ? `Потолок ${offlineCapSec() / 3600} ч` : 'Выручка в кассе'}</div>
        </div>
        ${btn('btn--cap', 'Забрать', fmt(p.amount), COIN)}`);
      el.querySelector('button').addEventListener('click', () => { onTake(); close(); });
      return el;
    },
  });
}

// ── Значки на вкладках ───────────────────────────────────────────────────────

export function updateBadges() {
  const d = S.daily.tasks.filter((t) => dailyReady(t)).length
    + (S.daily.tasks.length && S.daily.tasks.every((t) => t.done) && !S.daily.allDone ? 1 : 0);
  const a = ACHIEVEMENTS.filter((x) => achvState(x).ready).length;
  setBadge('tasks', d + a);
  setBadge('safes', safeReady() ? 1 : 0);
  const staffN = COUNTERS.filter((c) => S.counters[c.id].open && S.cash >= counterUpCost(c)).length
    + (S.cash >= runnerCost() && S.runner === 0 ? 1 : 0);
  setBadge('staff', Math.min(9, staffN));
}

export const screens = { staff, tasks, safes, shop, offline, close, refresh, isOpen, updateBadges };
