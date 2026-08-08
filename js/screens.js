// Окна игры: нижний лист, карточки, строки. Иконки — свой SVG-спрайт.

import { fmt, dur, clock, plural } from './core.js';
import {
  COUNTERS, ATMS, ZONES, STAFF, BOOSTS, SAFES, SHOP_GOLD, ACHIEVEMENTS, DAILY_POOL,
  DAILY_ALL, OFFLINE,
} from './balance.js';
import { S, save, emit } from './state.js';
import {
  counterPay, counterUpCost, upgradeCounter, atmRate, atmUpCost, upgradeAtm,
  clerkCost, clerkSpeed, hireClerk, runnerCost, hireRunner, boostLeft,
  shownIncome, offlineUpCost, offlineCapSec, autoIncome, zoneUpCost, upgradeZone, zoneBonus,
} from './game.js';
import { toast, haptic, setNav, setBadge } from './ui.js';

const root = () => document.getElementById('winRoot');
let cur = null;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const ic = (name, cls = 'ic') => `<span class="${cls}"><svg><use href="#${name}"/></svg></span>`;
const h = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d; };

/** Кнопка: заголовок + опционально цена с иконкой. */
function btn(cls, title, price, icon = 'i-coin', off = false) {
  return `<button class="btn ${cls}"${off ? ' disabled' : ''}>
    <span class="btn__t">${esc(title)}</span>
    ${price != null ? `<span class="btn__p">${ic(icon)}${price}</span>` : ''}
  </button>`;
}

// ── Каркас окна ──────────────────────────────────────────────────────────────

function open({ title, tabs, render, cap }) {
  close(true);
  const el = document.createElement('div');
  el.className = 'win';
  el.innerHTML = `
    <div class="win__body">
      <div class="win__grab"></div>
      <div class="win__head">
        <h2>${esc(title)}</h2>
        <button class="win__close">${ic('i-close', 'ic')}</button>
      </div>
      ${tabs ? `<div class="win__tabs">${tabs.map((t, i) =>
        `<button class="win__tab${i === 0 ? ' is-on' : ''}" data-i="${i}">${esc(t.label)}</button>`).join('')}</div>` : ''}
      <div class="win__scroll"></div>
      ${cap ? '<div class="win__cap"></div>' : ''}
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
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  if (tabs) {
    el.querySelectorAll('.win__tab').forEach((b) => b.addEventListener('click', () => {
      tabIdx = Number(b.dataset.i);
      el.querySelectorAll('.win__tab').forEach((x, i) => x.classList.toggle('is-on', i === tabIdx));
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
  setTimeout(() => el.remove(), 240);
  cur = null;
  if (!silent) setNav('bank');
}

export function refresh() { cur?.paint(); }
export function isOpen() { return !!cur; }

// ── ПЕРСОНАЛ ─────────────────────────────────────────────────────────────────

export function staff() {
  setNav('staff');
  open({
    title: 'Бизнес',
    tabs: [{ label: 'Стойки', render: staffView }, { label: 'Зоны', render: zonesView }],
    cap: () => {
      const cost = runnerCost();
      const lvl = S.runner;
      const maxed = lvl >= STAFF.runner.maxLvl;
      const el = h(`
        <span class="tile tile--cyan">${ic('i-run', 'ic')}</span>
        <div class="win__cap-txt">
          <div class="win__cap-t1">Администратор${lvl ? ` · ур. ${lvl}` : ''}</div>
          <div class="win__cap-t2">${lvl ? 'Сам относит выручку в кассу, даже когда вы вышли'
                                        : 'Пока его нет, выручку носите вы'}</div>
        </div>
        ${btn('btn--v', maxed ? 'Максимум' : lvl ? 'Улучшить' : 'Нанять',
              maxed ? null : fmt(cost), 'i-coin', maxed || S.cash < cost)}`);
      const b = el.querySelector('button');
      if (!maxed && S.cash >= cost) b.addEventListener('click', () => {
        if (hireRunner()) { haptic('success'); toast('Администратор вышел на смену'); refresh(); }
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
      <span class="tile">${ic('i-desk', 'ic')}</span>
      <div class="row__name">${esc(c.name)}<span class="pill">ур. ${st.lvl}</span></div>
      <div class="row__sub">${ic('i-coin')}${fmt(counterPay(c))}
        <span class="nx">→ ${fmt(counterPay(c) * 1.14)}</span></div>
      <div class="row__sub">${st.clerk
        ? `<span class="pill pill--ok">оператор ур. ${st.clerk}</span> ×${clerkSpeed(c).toFixed(2)}`
        : '<span class="pill pill--gold">без оператора</span>'}</div>
      ${btn('btn--ok btn--a', 'Улучшить', fmt(upC), 'i-coin', S.cash < upC)}
      ${btn('btn--v btn--b', maxed ? 'Максимум' : st.clerk ? 'Оператор +' : 'Оператор',
            maxed ? null : fmt(hireC), 'i-coin', maxed || S.cash < hireC)}
    </div>`).firstElementChild;
    const [bUp, bHire] = row.querySelectorAll('button');
    if (S.cash >= upC) bUp.addEventListener('click', () => { if (upgradeCounter(c)) { haptic(); refresh(); } });
    if (!maxed && S.cash >= hireC) bHire.addEventListener('click', () => {
      if (hireClerk(c)) { haptic('success'); toast(`${c.name}: оператор нанят`); refresh(); }
    });
    list.appendChild(row);
  }

  for (const a of ATMS) {
    const st = S.atms[a.id];
    if (!st.open) continue;
    const upC = atmUpCost(a);
    const row = h(`<div class="row">
      <span class="tile tile--cyan">${ic('i-locker', 'ic')}</span>
      <div class="row__name">${esc(a.name)}<span class="pill">ур. ${st.lvl}</span></div>
      <div class="row__sub">${ic('i-coin')}${fmt(atmRate(a))} в секунду</div>
      ${btn('btn--ok btn--row', 'Улучшить', fmt(upC), 'i-coin', S.cash < upC)}
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

function zonesView() {
  const wrap = document.createElement('div');
  const list = document.createElement('div');
  list.className = 'list';
  const EFF = { spawn: 'к потоку клиентов', pay: 'к оплате заказа',
                speed: 'к скорости операторов', offline: 'к доходу без вас' };
  for (const z of ZONES) {
    const st = S.zones?.[z.id] || { open: false, lvl: 1 };
    if (!st.open) {
      list.appendChild(h(`<div class="row" style="opacity:.62">
        <span class="tile">${ic('i-lock', 'ic')}</span>
        <div class="row__name">${esc(z.name)}</div>
        <div class="row__sub">${esc(z.desc)} · постройте в зале за ${fmt(z.cost)}</div>
      </div>`).firstElementChild);
      continue;
    }
    const cost = zoneUpCost(z);
    const maxed = st.lvl >= z.max;
    const tone = z.effect === 'pay' ? 'tile--gold' : z.effect === 'speed' ? 'tile--cyan'
               : z.effect === 'offline' ? 'tile--ok' : '';
    const row = h(`<div class="row">
      <span class="tile ${tone}">${ic(z.ic, 'ic')}</span>
      <div class="row__name">${esc(z.name)}<span class="pill">ур. ${st.lvl}</span></div>
      <div class="row__sub"><span class="pill pill--ok">+${Math.round(z.step * st.lvl * 100)}%</span>
        ${EFF[z.effect]}</div>
      ${btn('btn--ok btn--row', maxed ? 'Максимум' : 'Улучшить', maxed ? null : fmt(cost),
            'i-coin', maxed || S.cash < cost)}
    </div>`).firstElementChild;
    if (!maxed && S.cash >= cost) row.querySelector('button').addEventListener('click', () => {
      if (upgradeZone(z)) { haptic(); refresh(); }
    });
    list.appendChild(row);
  }
  wrap.appendChild(list);
  wrap.appendChild(h(`<div class="sect">Суммарно от зон</div>`).firstElementChild);
  wrap.appendChild(h(`<div class="row row--plain">
    <span class="tile tile--ok">${ic('i-up', 'ic')}</span>
    <div class="row__name">Бонусы бизнеса</div>
    <div class="row__sub">
      <span class="pill">поток +${Math.round(zoneBonus('spawn') * 100)}%</span>
      <span class="pill">оплата +${Math.round(zoneBonus('pay') * 100)}%</span>
      <span class="pill">скорость +${Math.round(zoneBonus('speed') * 100)}%</span>
      <span class="pill">офлайн +${Math.round(zoneBonus('offline') * 100)}%</span>
    </div>
  </div>`).firstElementChild);
  return wrap;
}

// ── ЗАДАНИЯ ──────────────────────────────────────────────────────────────────

export function tasks() {
  setNav('tasks');
  open({
    title: 'Задания',
    tabs: [{ label: 'На день', render: dailyView }, { label: 'Достижения', render: achvView }],
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
  const until = 86400 - (Date.now() / 1000) % 86400;
  wrap.appendChild(h(`<div class="sect">Обновятся через ${dur(until)}</div>`).firstElementChild);
  const list = document.createElement('div');
  list.className = 'list';
  for (const t of S.daily.tasks) {
    const d = dailyDef(t.id);
    if (!d) continue;
    const now = Math.min(dailyProgress(t), d.goal);
    const ready = dailyReady(t);
    const row = h(`<div class="row">
      <span class="tile ${t.done ? 'tile--ok' : ''}">${ic(t.done ? 'i-tasks' : 'i-box', 'ic')}</span>
      <div class="row__name">${esc(d.title)}</div>
      <div class="row__sub">${now} из ${d.goal}</div>
      <div class="bar${ready || t.done ? ' bar--ok' : ''}"><i style="width:${(now / d.goal) * 100}%"></i></div>
      ${btn(ready ? 'btn--gold btn--row' : 'btn--v btn--row', t.done ? 'Готово' : 'Забрать',
            t.done ? null : String(d.gold), 'i-gem', !ready)}
    </div>`).firstElementChild;
    if (ready) row.querySelector('button').addEventListener('click', () => {
      t.done = true; S.gold += d.gold;
      haptic('success'); toast(`+${d.gold}`); emit('task'); save(); refresh();
    });
    list.appendChild(row);
  }
  const all = S.daily.tasks.length && S.daily.tasks.every((t) => t.done);
  const bonus = h(`<div class="row">
    <span class="tile tile--gold">${ic('i-gift', 'ic')}</span>
    <div class="row__name">Все задания дня</div>
    <div class="row__sub">${S.daily.tasks.filter((t) => t.done).length} из ${S.daily.tasks.length}</div>
    ${btn(all && !S.daily.allDone ? 'btn--gold btn--row' : 'btn--v btn--row',
          S.daily.allDone ? 'Готово' : 'Забрать', S.daily.allDone ? null : String(DAILY_ALL.gold),
          'i-gem', !all || S.daily.allDone)}
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
  const now = S.stats[a.stat] || 0;
  return { tier, maxed, goal, cur: now, ready: !maxed && now >= goal, gold: maxed ? 0 : a.gold[tier] };
}

function achvView() {
  const wrap = document.createElement('div');
  const list = document.createElement('div');
  list.className = 'list';
  for (const a of ACHIEVEMENTS) {
    const st = achvState(a);
    const val = a.money ? fmt : (n) => fmt(Math.floor(n));
    const row = h(`<div class="row">
      <span class="tile ${st.maxed ? 'tile--gold' : ''}">${ic('i-up', 'ic')}</span>
      <div class="row__name">${esc(a.title)}
        <span class="pill">${Math.min(st.tier + 1, a.tiers.length)}/${a.tiers.length}</span></div>
      <div class="row__sub">${val(Math.min(st.cur, st.goal))} из ${val(st.goal)}</div>
      <div class="bar bar--gold"><i style="width:${Math.min(100, (st.cur / st.goal) * 100)}%"></i></div>
      ${btn(st.ready ? 'btn--gold btn--row' : 'btn--v btn--row', st.maxed ? 'Всё' : 'Забрать',
            st.maxed ? null : String(st.gold), 'i-gem', !st.ready)}
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

// ── НАГРАДЫ ──────────────────────────────────────────────────────────────────

export function safeReady() { return Date.now() >= (S.safe.freeAt || 0); }
export function safeLeft() { return Math.max(0, ((S.safe.freeAt || 0) - Date.now()) / 1000); }

export function safes() {
  setNav('safes');
  open({ title: 'Награды', render: safesView });
}

function hourCash(hrs) { return Math.max(shownIncome(), 4) * 3600 * hrs; }

function safesView() {
  const wrap = document.createElement('div');
  wrap.appendChild(h('<div class="sect">Посылки с наградой</div>').firstElementChild);
  const grid = document.createElement('div');
  grid.className = 'grid3';
  for (const s of Object.values(SAFES)) {
    const ready = s.cd ? safeReady() : S.gold >= s.gold;
    const tone = s.tone === 'gold' ? 'tile--gold' : s.tone === 'cyan' ? 'tile--cyan' : '';
    const card = h(`<div class="card">
      <div class="card__title">${esc(s.name)}</div>
      <div class="card__art"><span class="tile ${tone}" style="position:static;width:calc(58 * var(--du));height:calc(58 * var(--du))">${ic(s.ic, 'ic')}</span></div>
      <div class="card__sub">${fmt(hourCash(s.cashMin))}–${fmt(hourCash(s.cashMax))}</div>
      ${s.cd
        ? (ready ? btn('btn--ok btn--card', 'Открыть', null)
                 : `<button class="btn btn--card" disabled><span class="btn__t">${clock(safeLeft())}</span></button>`)
        : btn('btn--gold btn--card', 'Открыть', String(s.gold), 'i-gem', !ready)}
    </div>`).firstElementChild;
    const b = card.querySelector('button');
    if (b && ready) b.addEventListener('click', () => {
      const loot = openSafe(s);
      if (loot) { haptic('success'); toast(`+${fmt(loot.cash)} и +${loot.gold}`); refresh(); }
    });
    grid.appendChild(card);
  }
  wrap.appendChild(grid);

  wrap.appendChild(h('<div class="sect">Ускорители</div>').firstElementChild);
  const list = document.createElement('div');
  list.className = 'list';
  for (const b of Object.values(BOOSTS)) {
    const on = boostLeft(b.id);
    const freeIn = Math.max(0, ((S.freeBoost[b.id] || 0) - Date.now()) / 1000);
    const tone = b.tone === 'gold' ? 'tile--gold' : b.tone === 'cyan' ? 'tile--cyan' : '';
    const row = h(`<div class="row row--two">
      <span class="tile ${tone}">${ic(b.ic, 'ic')}</span>
      <div class="row__name">${esc(b.name)}${on ? `<span class="pill pill--ok">${clock(on)}</span>` : ''}</div>
      <div class="row__sub">${esc(b.desc)}</div>
      ${freeIn > 0
        ? `<button class="btn btn--a" disabled><span class="btn__t">${clock(freeIn)}</span></button>`
        : btn('btn--ok btn--a', 'Бесплатно', null)}
      ${btn('btn--gold btn--b', 'Купить', String(b.gold), 'i-gem', S.gold < b.gold)}
    </div>`).firstElementChild;
    const bs = row.querySelectorAll('button');
    if (freeIn <= 0) bs[0].addEventListener('click', () => {
      S.freeBoost[b.id] = Date.now() + b.freeCd * 1000;
      startBoost(b.id); haptic('success'); toast(`${b.name} включён`); refresh();
    });
    if (S.gold >= b.gold) bs[1].addEventListener('click', () => {
      S.gold -= b.gold; startBoost(b.id); haptic('success'); toast(`${b.name} включён`); refresh();
    });
    list.appendChild(row);
  }
  wrap.appendChild(list);

  wrap.appendChild(h('<div class="sect">Пока вас нет</div>').firstElementChild);
  const cap = offlineCapSec() / 3600;
  const cost = offlineUpCost();
  const off = h(`<div class="row">
    <span class="tile tile--cyan">${ic('i-clock', 'ic')}</span>
    <div class="row__name">Копится ${cap} ${plural(cap, 'час', 'часа', 'часов')}</div>
    <div class="row__sub">${ic('i-coin')}${fmt(autoIncome())} в секунду без вас</div>
    ${btn('btn--gold btn--row', cap >= OFFLINE.maxCapHours ? 'Максимум' : 'Больше',
          cap >= OFFLINE.maxCapHours ? null : String(cost), 'i-gem',
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
  const c = S.boosts[id];
  S.boosts[id] = { until: (c && c.until > now ? c.until : now) + d.dur * 1000 };
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
  wrap.appendChild(h('<div class="sect">Кристаллы</div>').firstElementChild);
  const grid = document.createElement('div');
  grid.className = 'grid3';
  for (const p of SHOP_GOLD) {
    const card = h(`<div class="card"${p.best ? ' style="outline:calc(2 * var(--du)) solid var(--v1);outline-offset:calc(-2 * var(--du))"' : ''}>
      <div class="card__title">${p.tag ? `<span class="pill pill--ok">${p.tag}</span>` : '&nbsp;'}</div>
      <div class="card__art"><span class="ic" style="width:calc(${Math.round(52 * p.size)} * var(--du));height:calc(${Math.round(52 * p.size)} * var(--du))"><svg><use href="#i-gem"/></svg></span></div>
      <div class="card__v">${ic('i-gem')}${fmt(p.gold)}</div>
      ${btn('btn--v btn--card', 'Купить', String(p.stars), 'i-gem')}
    </div>`).firstElementChild;
    card.querySelector('button').addEventListener('click', () => {
      window.__pay({ id: p.id, stars: p.stars, title: `${p.gold} кристаллов`, give: { gold: p.gold } });
    });
    grid.appendChild(card);
  }
  wrap.appendChild(grid);
  wrap.appendChild(h('<div class="empty">Оплата — звёздами Telegram</div>').firstElementChild);
  return wrap;
}

// ── ОФФЛАЙН ──────────────────────────────────────────────────────────────────

export function offline(p, onTake) {
  open({
    title: 'Пункт работал без вас',
    render: () => h(`<div class="card" style="padding:calc(20 * var(--du))">
        <div class="card__art" style="height:calc(84 * var(--du))">
          <span class="tile" style="position:static;width:calc(76 * var(--du));height:calc(76 * var(--du));border-radius:calc(24 * var(--du))">
            ${ic('i-box', 'ic')}</span></div>
        <div class="card__v" style="font-size:calc(24 * var(--du))">${ic('i-coin')}${fmt(p.amount)}</div>
        <div class="card__sub">За ${dur(p.seconds)}${p.capped ? ` · потолок ${offlineCapSec() / 3600} ч` : ''}</div>
      </div>`),
    cap: () => {
      const el = h(`
        <span class="tile tile--ok">${ic('i-coin', 'ic')}</span>
        <div class="win__cap-txt">
          <div class="win__cap-t1">Выручка в кассе</div>
          <div class="win__cap-t2">${p.capped ? 'Увеличьте потолок в «Наградах»' : 'Заказы выдавали операторы'}</div>
        </div>
        ${btn('btn--ok', 'Забрать', fmt(p.amount), 'i-coin')}`);
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
  const st = COUNTERS.filter((c) => S.counters[c.id].open && S.cash >= counterUpCost(c)).length
    + (S.cash >= runnerCost() && S.runner === 0 ? 1 : 0);
  setBadge('staff', Math.min(9, st));
}

export const screens = { staff, tasks, safes, shop, offline, close, refresh, isOpen, updateBadges };
