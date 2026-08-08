// Окна игры: нижний лист, карточки, строки. Иконки — свой SVG-спрайт.

import { fmt, dur, clock, plural } from './core.js';
import {
  COUNTERS, ATMS, ZONES, STAFF, BOOSTS, SAFES, SHOP_GOLD, ACHIEVEMENTS, DAILY_POOL,
  DAILY_ALL, OFFLINE, DISTRICT, REP, SMM,
} from './balance.js';
import { S, save, emit } from './state.js';
import {
  counterPay, counterUpCost, upgradeCounter, atmRate, atmUpCost, upgradeAtm,
  clerkCost, clerkSpeed, hireClerk, runnerCost, hireRunner, boostLeft,
  shownIncome, offlineUpCost, offlineCapSec, autoIncome, zoneUpCost, upgradeZone, zoneBonus,
} from './game.js';
import { toast, haptic, setNav, setBadge } from './ui.js';
import * as district from './district.js';
import * as reviews from './reviews.js';
import { resolveUpset } from './actors.js';
import * as coop from './coop.js';
import * as smm from './smm.js';

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
    tabs: [{ label: 'Стойки', render: staffView }, { label: 'Зоны', render: zonesView },
            { label: 'Отзывы', render: reviewsView }],
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

// ── ОТЗЫВЫ И РЕПУТАЦИЯ ───────────────────────────────────────────────────────

function starsRow(n) {
  let out = '';
  for (let i = 1; i <= 5; i++) {
    out += `<span class="st ${i <= Math.round(n) ? 'on' : ''}">★</span>`;
  }
  return `<span class="stars">${out}</span>`;
}

function reviewsView() {
  const wrap = document.createElement('div');
  reviews.ensure();
  const r = reviews.stars();
  wrap.appendChild(h(`<div class="card" style="padding:calc(16 * var(--du))">
    <div class="card__v" style="font-size:calc(30 * var(--du));gap:calc(8 * var(--du))">
      ${r.toFixed(1)} ${starsRow(r)}</div>
    <div class="card__sub">Поток клиентов ${r >= 3 ? '+' : ''}${Math.round((reviews.spawnMult() - 1) * 100)}%
      · средний чек ${r >= 3 ? '+' : ''}${Math.round((reviews.payMult() - 1) * 100)}%</div>
  </div>`).firstElementChild);

  wrap.appendChild(h('<div class="sect">Настроение операторов</div>').firstElementChild);
  const ml = document.createElement('div');
  ml.className = 'list';
  let any = false;
  for (const c of COUNTERS) {
    const st = S.counters[c.id];
    if (!st.open || !st.clerk) continue;
    any = true;
    const m = reviews.morale(c.id);
    const tone = m < 0.8 ? 'tile--gold' : m > 1.05 ? 'tile--ok' : '';
    ml.appendChild(h(`<div class="row row--plain">
      <span class="tile ${tone}">${ic('i-staff', 'ic')}</span>
      <div class="row__name">${esc(c.name)}</div>
      <div class="row__sub">${m < 0.8 ? 'обижен после штрафа' : m > 1.05 ? 'воодушевлён' : 'работает ровно'}
        · скорость ×${m.toFixed(2)}</div>
      <div class="bar ${m < 0.8 ? 'bar--gold' : 'bar--ok'}"><i style="width:${Math.round(m / 1.25 * 100)}%"></i></div>
    </div>`).firstElementChild);
  }
  if (!any) ml.innerHTML = '<div class="empty">Наймите операторов — у них появится настроение</div>';
  wrap.appendChild(ml);

  wrap.appendChild(h('<div class="sect">Что пишут клиенты</div>').firstElementChild);
  const list = document.createElement('div');
  list.className = 'list';
  const feed = reviews.feed();
  if (!feed.length) list.innerHTML = '<div class="empty">Отзывов пока нет</div>';
  for (const v of feed.slice(0, 14)) {
    const tone = v.kind === 'good' ? 'tile--ok' : v.kind === 'solved' ? 'tile--cyan' : 'tile--gold';
    list.appendChild(h(`<div class="row row--plain">
      <span class="tile ${tone}">${ic('i-staff', 'ic')}</span>
      <div class="row__name">${esc(v.who)} ${starsRow(v.stars)}</div>
      <div class="row__sub">${esc(v.text)}${v.at ? ` · ${esc(v.at)}` : ''}</div>
    </div>`).firstElementChild);
  }
  wrap.appendChild(list);
  return wrap;
}

// ── РАЗБОР ПРЕТЕНЗИИ ─────────────────────────────────────────────────────────

export function incident(k, onClose) {
  const c = COUNTERS.find((x) => x.id === k.counter);
  const inc = k.incident || { text: 'Что-то пошло не так', blame: 'both' };
  const fineSum = reviews.fineAmount(k.counter, 'fine');
  const bonusSum = reviews.fineAmount(k.counter, 'bonus');
  const m = reviews.morale(k.counter);

  const done = (msg, tone) => {
    resolveUpset(k);
    close();
    onClose?.();
    if (msg) toast(msg);
    haptic(tone || 'success');
  };

  const el = open({
    title: 'Разбор',
    render: () => h(`<div class="card" style="padding:calc(16 * var(--du))">
        <div class="row__name" style="justify-content:center;font-size:calc(17 * var(--du))">
          ${esc(inc.text)}</div>
        <div class="card__sub" style="margin-top:calc(6 * var(--du))">
          ${esc(c ? c.name : '')} · оператор ${S.counters[k.counter]?.clerk ? 'ур. ' + S.counters[k.counter].clerk : 'не нанят'}
          · настроение ×${m.toFixed(2)}</div>
      </div>
      <div class="sect">Что делаем</div>
      <div class="list" id="opts"></div>`),
  });

  const opts = el.el.querySelector('#opts');
  const add = (icon, tone, name, sub, btnCls, btnT, btnP, onClick, off) => {
    const row = h(`<div class="row">
      <span class="tile ${tone}">${ic(icon, 'ic')}</span>
      <div class="row__name">${name}</div>
      <div class="row__sub">${sub}</div>
      ${btn(btnCls + ' btn--row', btnT, btnP, 'i-coin', off)}
    </div>`).firstElementChild;
    if (!off) row.querySelector('button').addEventListener('click', onClick);
    opts.appendChild(row);
  };

  add('i-staff', 'tile--gold', 'Оштрафовать', 'Скандал гаснет, но оператор обидится',
      'btn--gold', 'Штраф', fmt(fineSum), () => {
        const r = reviews.fine(k.counter);
        done(`Штраф ${fmt(r.sum)} · настроение ×${r.morale.toFixed(2)}`, 'warning');
      });

  add('i-tasks', '', 'Разобраться', 'Может, клиент и не прав — тогда оператор воспрянет',
      'btn--v', 'Выяснить', null, () => {
        const r = reviews.investigate(k.counter, inc);
        done(r.staffRight ? 'Оператор был прав — репутация выросла'
                          : 'Виноват пункт. Клиент ушёл недовольным', r.staffRight ? 'success' : 'warning');
      });

  const canPay = S.cash >= bonusSum;
  add('i-gift', 'tile--ok', 'Извиниться', 'Дороже всего, но репутация растёт сильнее',
      'btn--ok', 'Бонус', fmt(bonusSum), () => {
        const r = reviews.apologize(k.counter);
        if (r) done(`Извинились · −${fmt(r.sum)}`, 'success');
      }, !canPay);

  // закрыли окно без решения — клиент остаётся ждать
  const orig = el.el.querySelector('.win__close');
  orig.addEventListener('click', () => onClose?.());
  el.el.addEventListener('click', (e) => { if (e.target === el.el) onClose?.(); });
}

// ── ЗАДАНИЯ ──────────────────────────────────────────────────────────────────

export function tasks(sub) {
  setNav('tasks');
  const m = open({
    title: 'Задания',
    tabs: [{ label: 'На день', render: dailyView }, { label: 'Район', render: districtView },
            { label: 'Награды', render: achvView }],
  });
  if (sub === 'district') m.el.querySelectorAll('.win__tab')[1]?.click();
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

// ── РАЙОН: гонка с конкурентом через дорогу ──────────────────────────────────

function districtView() {
  const wrap = document.createElement('div');
  district.ensure();
  const d = S.district;
  const p = district.pending();

  if (p) {
    const box = h(`<div class="card" style="padding:calc(18 * var(--du))">
      <div class="card__art" style="height:calc(72 * var(--du))">
        <span class="tile ${p.won ? 'tile--gold' : ''}" style="position:static;width:calc(68 * var(--du));height:calc(68 * var(--du));border-radius:calc(22 * var(--du))">
          ${ic(p.won ? 'i-up' : 'i-box', 'ic')}</span></div>
      <div class="card__v" style="font-size:calc(19 * var(--du))">${p.won ? 'Район ваш!' : 'Неделя проиграна'}</div>
      <div class="card__sub">Вы ${fmt(p.my)} · ${esc(DISTRICT.name)} ${fmt(p.foe)}</div>
      ${btn('btn--gold btn--card', 'Забрать', String(p.gold), 'i-gem')}
    </div>`).firstElementChild;
    box.querySelector('button').addEventListener('click', () => {
      const r = district.claim();
      if (r) { haptic('success'); toast(`+${r.gold}`); refresh(); }
    });
    wrap.appendChild(box);
  }

  const my = Math.floor(d.my), foe = Math.floor(d.foe);
  const lead = district.lead();
  const ahead = my >= foe;
  wrap.appendChild(h(`<div class="sect">Неделя района · осталось ${dur(district.weekLeft())}</div>`).firstElementChild);
  wrap.appendChild(h(`<div class="card" style="padding:calc(14 * var(--du))">
    <div style="display:flex;align-items:center;justify-content:space-between;
      font-size:calc(12 * var(--du));font-weight:900">
      <span style="color:var(--v1)">Вы · ${fmt(my)}</span>
      <span style="color:#E24A6A">${esc(DISTRICT.name)} · ${fmt(foe)}</span>
    </div>
    <div style="height:calc(14 * var(--du));border-radius:calc(7 * var(--du));overflow:hidden;
      margin-top:calc(8 * var(--du));background:#E24A6A;display:flex">
      <i style="width:${Math.round(lead * 100)}%;background:linear-gradient(90deg,#A78BFA,var(--v1))"></i>
    </div>
    <div class="card__sub" style="margin-top:calc(8 * var(--du))">
      ${ahead ? 'Вы впереди — держите темп' : `Отстаёте на ${fmt(foe - my)} ${plural(foe - my, 'заказ', 'заказа', 'заказов')}`}
    </div>
  </div>`).firstElementChild);

  const rows = [
    ['i-run', 'Соперник', `${esc(DISTRICT.name)} · уровень ${d.foeLvl}`,
     `берёт ${Math.round(district.foeFactor() * 100)}% от вашего темпа`],
    ['i-up', 'Счёт', `Побед ${d.wins} · поражений ${d.losses}`,
     d.streak > 1 ? `серия ${d.streak} подряд` : 'серия сбрасывается при поражении'],
    ['i-gift', 'Награда', `${DISTRICT.winGold}+ кристаллов за победу`,
     'за каждую победу подряд — больше'],
  ];
  const list = document.createElement('div');
  list.className = 'list';
  for (const [icon, name, a, b] of rows) {
    list.appendChild(h(`<div class="row row--plain">
      <span class="tile">${ic(icon, 'ic')}</span>
      <div class="row__name">${name}</div>
      <div class="row__sub">${a}</div>
      <div class="row__sub" style="color:var(--ink3)">${b}</div>
    </div>`).firstElementChild);
  }
  wrap.appendChild(list);
  wrap.appendChild(h(`<div class="empty">Соперник работает и пока вас нет — но вполсилы</div>`).firstElementChild);
  return wrap;
}

// ── НАГРАДЫ ──────────────────────────────────────────────────────────────────

export function safeReady() { return Date.now() >= (S.safe.freeAt || 0); }
export function safeLeft() { return Math.max(0, ((S.safe.freeAt || 0) - Date.now()) / 1000); }

export function safes() {
  setNav('safes');
  open({ title: 'Награды', render: safesView });
}

/** Награда считается от РЕАЛЬНОГО дохода. Раньше здесь стоял пол в 4/с —
 *  втрое выше стартовой экономики, и первая же посылка ломала весь темп. */
function hourCash(hrs) {
  const floor = COUNTERS[0].base * 0.12;      // чтобы на самом старте награда не была нулевой
  return Math.max(shownIncome(), floor) * 3600 * hrs;
}

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

// ── ВМЕСТЕ ───────────────────────────────────────────────────────────────────
// Вход по коду, а не только по ссылке: ссылка-приглашение работает лишь когда
// у бота настроено главное мини-приложение, и до тех пор друг просто попадал
// в чат с ботом. Код работает всегда.

export function together() {
  open({ title: 'Вместе', render: coopView });
}

function coopView() {
  const wrap = document.createElement('div');
  const code = coop.myCode();
  const away = coop.visiting();

  if (!code) {
    wrap.appendChild(h('<div class="empty">Совместная игра работает только внутри Telegram — там у пункта появляется код.</div>').firstElementChild);
    return wrap;
  }

  if (away) {
    const who = coop.others().find((p) => p.id === coop.coop.roomId);
    wrap.appendChild(h(`<div class="note note--v">
      <b>Вы в гостях${who ? ` у ${esc(who.name)}` : ''}</b>
      <span>${coop.coop.hostOnline ? 'Помогайте: вставайте за стойку и на площадки — заработок и стройка идут хозяину.' : 'Хозяин сейчас не в сети, пункт замер. Загляните позже.'}</span>
    </div>`).firstElementChild);
    const back = h(btn('btn--v btn--wide', 'Вернуться в свой пункт', null)).firstElementChild;
    back.addEventListener('click', () => { window.__goHome?.(); close(); });
    wrap.appendChild(back);
    return wrap;
  }

  wrap.appendChild(h('<div class="sect">Код вашего пункта</div>').firstElementChild);
  const codeBox = h(`<div class="codebox"><b>${esc(code)}</b>${ic('i-box', 'ic')}</div>`).firstElementChild;
  codeBox.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); toast('Код скопирован'); }
    catch { toast('Продиктуйте код другу: ' + code); }
    haptic('light');
  });
  wrap.appendChild(codeBox);

  const share = h(btn('btn--v btn--wide', 'Позвать друга ссылкой', null)).firstElementChild;
  share.addEventListener('click', () => window.__invite?.());
  wrap.appendChild(share);

  const list = coop.others();
  wrap.appendChild(h(`<div class="empty">${list.length
    ? `Сейчас в зале: ${list.map((p) => esc(p.name)).join(', ')}`
    : 'Пока вы в пункте один'}</div>`).firstElementChild);

  wrap.appendChild(h('<div class="sect">Зайти к другу</div>').firstElementChild);
  const row = h(`<div class="joinrow">
    <input class="joinrow__i" inputmode="numeric" placeholder="Код пункта друга" maxlength="16">
    <button class="btn btn--v joinrow__b"><span class="btn__t">Зайти</span></button>
  </div>`).firstElementChild;
  const input = row.querySelector('input');
  row.querySelector('button').addEventListener('click', () => {
    const v = input.value.replace(/\D/g, '');
    if (!v) { toast('Введите код друга'); return; }
    if (v === code) { toast('Это код вашего же пункта'); return; }
    window.__visit?.(v);
    close();
  });
  wrap.appendChild(row);
  wrap.appendChild(h('<div class="empty">Код — это номер пункта. Друг диктует его вам, вы вводите здесь.</div>').firstElementChild);
  return wrap;
}

// ── СОЦСЕТЬ ──────────────────────────────────────────────────────────────────
// Всё, что о пункте думает город: рейтинг, лента отзывов и настроение смены.
// Сюда же стекаются тексты, написанные моделью по реальным событиям в зале.

export function social(sub) {
  const m = open({
    title: 'Соцсеть',
    tabs: [{ label: 'Лента', render: feedView }, { label: 'Продвижение', render: promoView },
           { label: 'Смена', render: shiftView }],
  });
  if (sub === 'promo') m.el.querySelectorAll('.win__tab')[1]?.click();
  if (sub === 'shift') m.el.querySelectorAll('.win__tab')[2]?.click();
  S.seenReviews = (S.reviews || []).length;
  save();
  return m;
}

function starRow(n, size = 13) {
  let out = '';
  for (let i = 1; i <= 5; i++) {
    const on = n >= i - 0.25;
    out += `<span class="st${on ? ' is-on' : ''}" style="width:calc(${size} * var(--du));height:calc(${size} * var(--du))"><svg><use href="#i-star"/></svg></span>`;
  }
  return out;
}

function ago(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return `${Math.floor(s / 86400)} дн назад`;
}

function feedView() {
  const wrap = document.createElement('div');
  const r = reviews.stars();
  const spawn = Math.round((reviews.spawnMult() - 1) * 100);
  const pay = Math.round((reviews.payMult() - 1) * 100);
  const sign = (v) => `${v >= 0 ? '+' : ''}${v}%`;
  wrap.appendChild(h(`<div class="repcard">
    <div class="repcard__n">${r.toFixed(1)}</div>
    <div class="repcard__r">
      <div class="repcard__stars">${starRow(r, 16)}</div>
      <div class="repcard__s">Поток клиентов ${sign(spawn)} · средний чек ${sign(pay)}</div>
    </div>
  </div>`).firstElementChild);

  const list = reviews.feed();
  if (!list.length) {
    wrap.appendChild(h('<div class="empty">В ленте пока тихо. Обслужите первых клиентов — город заговорит.</div>').firstElementChild);
    return wrap;
  }
  wrap.appendChild(h('<div class="sect">Лента квартала</div>').firstElementChild);
  for (const v of list) wrap.appendChild(postCard(v));
  return wrap;
}

const POST_ICON = { news: 'i-bolt', smm: 'i-shop' };

/** Карточка ленты. Отзыв, новость района и пост пункта различаются шапкой,
 *  но живут одним потоком — это и делает экран лентой, а не списком жалоб. */
function postCard(v) {
  const news = v.kind === 'news', promo = v.kind === 'smm';
  const head = news || promo
    ? `<span class="post__ava post__ava--${v.kind}">${ic(POST_ICON[v.kind], 'ic')}</span>`
    : `<div class="post__ava">${esc(v.who.slice(0, 1))}</div>`;
  const meta = promo
    ? `<div class="post__likes">${ic('i-heart')}${fmt(v.likes || 0)}</div>`
    : (news ? '' : `<div class="post__stars">${starRow(v.stars, 11)}</div>`);
  return h(`<div class="post post--${v.kind}">
    ${head}
    <div class="post__b">
      <div class="post__h"><b>${esc(v.who)}</b><span class="post__t">${ago(v.t)}</span></div>
      ${meta}
      <div class="post__x">${esc(v.text)}</div>
      ${v.at ? `<div class="post__at">${esc(v.at)}</div>` : ''}
    </div>
  </div>`).firstElementChild;
}

// ── Продвижение ──────────────────────────────────────────────────────────────

function promoView() {
  const wrap = document.createElement('div');
  const lvl = smm.level();
  const reach = Math.round((1 + SMM.reachPerLvl * lvl - 1) * 100);
  const left = Math.round(smm.boostLeft());

  wrap.appendChild(h(`<div class="promo">
    <div class="promo__h">
      <span class="promo__ic">${ic('i-shop', 'ic')}</span>
      <div>
        <b>${lvl ? esc(smm.title()) : 'Страницу никто не ведёт'}</b>
        <i>${lvl ? `Охват пункта +${reach}% постоянно` : 'Пункт живёт только на сарафанном радио'}</i>
      </div>
    </div>
    ${lvl ? `<div class="promo__row">
      <span>Пост каждые ${dur(smm.postEvery())}</span>
      <span>${left ? `Пост работает ещё ${dur(left)}` : 'Ждём следующий пост'}</span>
    </div>` : ''}
  </div>`).firstElementChild);

  if (left) {
    wrap.appendChild(h(`<div class="note note--v">
      <b>Пост разлетелся</b>
      <span>Пока он в ленте, клиентов приходит на ${Math.round(SMM.boost * 100)}% больше.</span>
    </div>`).firstElementChild);
  }

  if (smm.maxed()) {
    wrap.appendChild(h('<div class="empty">Дальше некуда: о пункте пишет весь городской паблик.</div>').firstElementChild);
  } else {
    const price = smm.cost();
    const next = SMM.titles[Math.min(lvl + 1, SMM.titles.length - 1)];
    const b = h(btn('btn--v btn--wide', lvl ? `Нанять: ${next}` : `Нанять: ${next}`, fmt(price), 'i-coin',
                    S.cash < price)).firstElementChild;
    b.addEventListener('click', () => {
      const r = smm.hire();
      if (!r) { toast('Не хватает денег'); return; }
      haptic('success');
      toast(`${smm.title()} взялся за страницу`);
      refresh();
    });
    wrap.appendChild(b);
    wrap.appendChild(h(`<div class="empty">Каждый уровень поднимает постоянный охват на ${Math.round(SMM.reachPerLvl * 100)}% и учащает посты.</div>`).firstElementChild);
  }

  const posts = reviews.feed().filter((v) => v.kind === 'smm').slice(0, 6);
  if (posts.length) {
    wrap.appendChild(h('<div class="sect">Последние посты</div>').firstElementChild);
    for (const v of posts) wrap.appendChild(postCard(v));
  }
  return wrap;
}

function shiftView() {
  const wrap = document.createElement('div');
  wrap.appendChild(h('<div class="sect">Настроение операторов</div>').firstElementChild);
  const open_ = COUNTERS.filter((c) => S.counters[c.id].open);
  if (!open_.length) {
    wrap.appendChild(h('<div class="empty">Откройте первую витрину — появится и смена.</div>').firstElementChild);
  }
  for (const c of open_) {
    const st = S.counters[c.id];
    const m = reviews.morale(c.id);
    const k = Math.max(0, Math.min(1, (m - 0.45) / 0.8));
    const mood = m >= 1.05 ? 'В ударе' : m >= 0.9 ? 'В норме' : m >= 0.7 ? 'Подавлен' : 'На грани';
    const tone = m >= 1.05 ? 'ok' : m >= 0.9 ? '' : m >= 0.7 ? 'warn' : 'bad';
    wrap.appendChild(h(`<div class="mrow mrow--${tone || 'norm'}">
      <div class="mrow__t"><b>${esc(c.name)}</b><i>${st.clerk ? `${st.clerk} ${plural(st.clerk, 'оператор', 'оператора', 'операторов')}` : 'без оператора'}</i></div>
      <div class="mrow__r">
        <div class="mrow__bar"><i style="width:${Math.round(k * 100)}%"></i></div>
        <span class="mrow__m">${mood}</span>
      </div>
    </div>`).firstElementChild);
  }

  wrap.appendChild(h('<div class="sect">Как вы решали споры</div>').firstElementChild);
  const st = S.stats || {};
  const cells = [
    ['Разобрались', st.checks || 0, 'i-search'],
    ['Штрафов', st.fines || 0, 'i-warn'],
    ['Извинений', st.apologies || 0, 'i-heart'],
    ['Ушли не дождавшись', st.walkouts || 0, 'i-exit'],
  ];
  const grid = h('<div class="grid2"></div>').firstElementChild;
  for (const [name, val, icon] of cells) {
    grid.appendChild(h(`<div class="stat">
      <span class="tile">${ic(icon, 'ic')}</span>
      <b>${fmt(val)}</b><i>${name}</i>
    </div>`).firstElementChild);
  }
  wrap.appendChild(grid);
  wrap.appendChild(h('<div class="empty">Долгая очередь портит настроение клиентов прямо в зале: подходите к тем, над кем висит хмурый значок.</div>').firstElementChild);
  return wrap;
}

// ── НАСТРОЙКИ ────────────────────────────────────────────────────────────────
// Плавность здесь — не косметика: именно она решает, насколько греется телефон.

const QUALITY = [
  { id: 'auto', name: 'Авто', hint: 'подстраиваемся под телефон' },
  { id: 'high', name: 'Плавно', hint: '60 кадров, греет сильнее' },
  { id: 'saver', name: 'Экономно', hint: '30 кадров, холоднее и дольше держит заряд' },
];

export function settings() {
  open({ title: 'Настройки', render: settingsView });
}

function settingsView() {
  const wrap = document.createElement('div');
  wrap.appendChild(h('<div class="sect">Плавность</div>').firstElementChild);

  const row = h('<div class="segs"></div>').firstElementChild;
  const cur = S.settings.quality || 'auto';
  for (const q of QUALITY) {
    const b = h(`<button class="seg${q.id === cur ? ' is-on' : ''}"><b>${q.name}</b><i>${q.hint}</i></button>`).firstElementChild;
    b.addEventListener('click', () => {
      S.settings.quality = q.id;
      window.__applyQuality?.();
      save(true);
      refresh();
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);

  wrap.appendChild(h('<div class="sect">Прочее</div>').firstElementChild);
  wrap.appendChild(toggle('Эффекты', 'монетки, вспышки и всплывающие числа', 'fx'));
  wrap.appendChild(toggle('Вибрация', 'отклик при постройке и наградах', 'haptics'));
  wrap.appendChild(h('<div class="empty">Если телефон греется — включите «Экономно».</div>').firstElementChild);
  return wrap;
}

function toggle(name, hint, key) {
  const on = S.settings[key] !== false;
  const el = h(`<button class="setrow${on ? ' is-on' : ''}">
    <span class="setrow__t"><b>${name}</b><i>${hint}</i></span>
    <span class="setrow__sw"></span>
  </button>`).firstElementChild;
  el.addEventListener('click', () => { S.settings[key] = !on; save(true); refresh(); });
  return el;
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
  setBadge('tasks', d + a + (district.pending() ? 1 : 0));
  setBadge('safes', safeReady() ? 1 : 0);
  const st = COUNTERS.filter((c) => S.counters[c.id].open && S.cash >= counterUpCost(c)).length
    + (S.cash >= runnerCost() && S.runner === 0 ? 1 : 0);
  setBadge('staff', Math.min(9, st));
}

export const screens = { staff, tasks, safes, shop, offline, incident, close, refresh, isOpen, updateBadges };
