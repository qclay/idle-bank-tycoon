// Содержимое всех модальных окон.

import { fmt, money, int, dur, clock, pct, mult } from './fmt.js';
import {
  BANKS, FLOOR_DEFS, ACHIEVEMENTS, CONTRACTS, CHESTS, SUPER_MANAGERS, RARITY,
  SM_SLOTS, SM_LEVEL_POWER, BOOSTS, SHOP_GOLD, SHOP_OFFERS, BOARD_UPGRADES,
  DAILY_LOGIN, OFFLINE, PRESTIGE, DAILY_ALL_BONUS,
} from './balance.js';
import { S, bank, save } from './state.js';
import {
  incomePerSec, bonuses, unlockBank, switchBank, floorMgrCost, elevMgrCost, vaultMgrCost,
  hireFloorMgr, hireElevMgr, hireVaultMgr, canRenovate, renovationShares, renovate,
  boardCost, buyBoard, contractProgress, claimContract, openFloors,
  offlineCapUpCost, offlineCapSeconds, boostLeft, floorStats, elevStats, vaultStats,
} from './engine.js';
import {
  dailyDef, dailyGoal, dailyProgress, dailyDone, claimDaily, dailyAllDone, claimDailyAll,
  achvState, claimAchv, chestReady, chestLeft, openChest, smNeed, smPower,
  equipSm, unequipSm, unlockSmSlot, activateBoost, claimFreeBoost, boostFreeLeft,
  upgradeOfflineCap, claimOffline, loginAvailable, loginDay, claimLogin, grant,
} from './meta.js';
import { openModal, closeModal, toast, haptic, markDirty, resetNav } from './ui.js';
import { pay } from './pay.js';
import * as scene from './scene.js';

const h = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

let live = null;   // текущая функция перерисовки открытого окна

function shell(title, sub, render, tabs) {
  const m = openModal({ title, sub, body: '', tabs });
  live = () => {
    if (!document.body.contains(m.body)) { live = null; return; }
    if (!tabs) { const y = m.body.scrollTop; m.body.innerHTML = ''; m.body.appendChild(render()); m.body.scrollTop = y; }
  };
  if (!tabs) { m.body.appendChild(render()); }
  return m;
}

export function refreshOpen() { if (live) live(); }

// ─────────────────────────────────────────────────────────────────────────────
// ЗАДАНИЯ
// ─────────────────────────────────────────────────────────────────────────────

export function tasks() {
  const m = openModal({
    title: 'Задания',
    sub: 'Ежедневные цели, контракты банка и достижения',
    tabs: [
      { label: 'Ежедневные', render: dailyView },
      { label: 'Контракты', render: contractsView },
      { label: 'Достижения', render: achvView },
    ],
  });
  live = () => {
    if (!document.body.contains(m.body)) { live = null; return; }
    const on = m.sheet.querySelector('.tabs .on');
    const idx = [...m.sheet.querySelectorAll('.tabs button')].indexOf(on);
    const rend = [dailyView, contractsView, achvView][idx] || dailyView;
    const y = m.body.scrollTop;
    m.body.innerHTML = '';
    m.body.appendChild(rend());
    m.body.scrollTop = y;
  };
}

function dailyView() {
  const wrap = document.createElement('div');
  const until = 86400 - (Date.now() / 1000) % 86400;
  wrap.appendChild(h(`<div class="card" style="display:flex;align-items:center;gap:8px">
    <div class="row-ic">⏳</div>
    <div class="grow"><div class="t1">Обновление через ${dur(until)}</div>
    <div class="t2">Выполните все 4 задания и получите бонус</div></div>
  </div>`));

  for (const t of S.daily.tasks) {
    const def = dailyDef(t.id);
    if (!def) continue;
    const goal = dailyGoal(t);
    const cur = Math.min(dailyProgress(t), goal);
    const done = dailyDone(t);
    const isMoney = !!def.rel;
    const card = h(`<div class="card"><div class="row">
      <div class="row-ic">${done ? '✅' : '🎯'}</div>
      <div class="grow">
        <div class="t1">${esc(def.title)}</div>
        <div class="t2">${isMoney ? money(cur) : int(cur)} / ${isFinite(goal) ? (isMoney ? money(goal) : int(goal)) : '—'}</div>
        <div class="pbar"><i style="width:${Math.min(100, (cur / goal) * 100 || 0)}%"></i></div>
      </div>
      <button class="btn btn-sm ${t.claimed ? 'btn-grey' : done ? 'btn-gold' : 'btn-grey'}">${t.claimed ? 'Готово' : rewardLabel(def.reward)}</button>
    </div></div>`).firstElementChild;
    const btn = card.querySelector('button');
    if (!t.claimed && done) {
      btn.addEventListener('click', () => {
        const got = claimDaily(t);
        if (got) { toast(`Награда: ${got.map(lootLabel).join(', ')}`); haptic('success'); refreshOpen(); markDirty(); }
      });
    } else btn.classList.add('off');
    wrap.appendChild(card);
  }

  const allDone = dailyAllDone();
  const bonus = h(`<div class="card" style="border-color:var(--gold);background:linear-gradient(180deg,#fffaf0,#fff)">
    <div class="row">
      <div class="row-ic">🏆</div>
      <div class="grow"><div class="t1">Все задания дня</div>
      <div class="t2">${DAILY_ALL_BONUS.gold} золота + серебряный сейф</div></div>
      <button class="btn btn-sm ${allDone && !S.daily.allClaimed ? 'btn-gold' : 'btn-grey off'}">
        ${S.daily.allClaimed ? 'Получено' : 'Забрать'}</button>
    </div></div>`).firstElementChild;
  if (allDone && !S.daily.allClaimed) {
    bonus.querySelector('button').addEventListener('click', () => {
      const got = claimDailyAll();
      if (got) {
        const chest = got.find((g) => g.kind === 'chest');
        if (chest) { const loot = openChestFree(chest.id); if (loot) chestResult(loot); }
        toast('Бонус дня получен!'); haptic('success'); refreshOpen(); markDirty();
      }
    });
  }
  wrap.appendChild(bonus);
  return wrap;
}

function openChestFree(id) {
  // выдача сундука из награды — без списания золота и кулдауна
  const def = CHESTS[id];
  const saveGold = def.gold; const saveCd = def.cd;
  def.gold = 0; def.cd = 0;
  const loot = openChest(id);
  def.gold = saveGold; def.cd = saveCd;
  return loot;
}

function rewardLabel(r) {
  if (r.gold) return `<i class="ic ic-gold"></i> ${r.gold}`;
  if (r.cashHours) return `<i class="ic-cash"></i> ${r.cashHours}ч`;
  return 'Забрать';
}

function lootLabel(g) {
  if (g.kind === 'gold') return `<i class="ic ic-gold"></i> ${int(g.amount)}`;
  if (g.kind === 'cash') return `<i class="ic-cash"></i> ${money(g.amount)}`;
  if (g.kind === 'boost') return `⚡ ${BOOSTS[g.id]?.name || 'буст'}`;
  if (g.kind === 'card') return `🃏 ${SUPER_MANAGERS.find((m) => m.id === g.id)?.name || ''} ×${g.shards}`;
  if (g.kind === 'chest') return `🎁 сейф`;
  return '';
}

function contractsView() {
  const wrap = document.createElement('div');
  const b = bank();
  const p = contractProgress();
  wrap.appendChild(h(`<div class="card"><div class="row">
    <div class="row-ic">${BANKS[S.bankIdx].flag}</div>
    <div class="grow"><div class="t1">${esc(BANKS[S.bankIdx].name)}</div>
    <div class="t2">Выполнено контрактов: ${b.contract} из ${CONTRACTS.length}</div></div>
  </div></div>`));

  if (!p) {
    wrap.appendChild(h('<div class="empty">Все контракты этого банка выполнены. Откройте новый город!</div>'));
    return wrap;
  }
  const card = h(`<div class="card" style="border-color:var(--blue)"><div class="row">
    <div class="row-ic">📋</div>
    <div class="grow"><div class="t1">${esc(p.def.title)}</div>
      <div class="t2">${int(p.cur)} / ${int(p.goal)}</div>
      <div class="pbar"><i style="width:${(p.cur / p.goal) * 100}%"></i></div></div>
    <button class="btn btn-sm ${p.done ? 'btn-gold' : 'btn-grey off'}"><i class="ic ic-gold"></i> ${p.def.reward.gold}</button>
  </div></div>`).firstElementChild;
  if (p.done) card.querySelector('button').addEventListener('click', () => {
    const r = claimContract();
    if (r) { toast(`Контракт выполнен! +${r.gold} золота`); haptic('success'); refreshOpen(); markDirty(); }
  });
  wrap.appendChild(card);

  // следующие
  const next = CONTRACTS.slice(b.contract + 1, b.contract + 5);
  if (next.length) {
    wrap.appendChild(h('<div class="t2" style="margin:10px 2px 6px">Далее</div>'));
    for (const c of next) {
      wrap.appendChild(h(`<div class="card" style="opacity:.62"><div class="row">
        <div class="row-ic">🔒</div><div class="grow"><div class="t1">${esc(c.title)}</div></div>
        <span class="pill gold"><i class="ic ic-gold"></i> ${c.reward.gold}</span></div></div>`));
    }
  }
  return wrap;
}

function achvView() {
  const wrap = document.createElement('div');
  for (const a of ACHIEVEMENTS) {
    const st = achvState(a);
    const val = a.money ? money : int;
    const card = h(`<div class="card"><div class="row">
      <div class="row-ic">${st.maxed ? '🏅' : '⭐'}</div>
      <div class="grow">
        <div class="t1">${esc(a.title)} ${st.maxed ? '' : `<span class="pill">${st.tier + 1}/${a.tiers.length}</span>`}</div>
        <div class="t2">${esc(a.desc)}: ${val(Math.min(st.cur, st.goal))} / ${val(st.goal)}</div>
        <div class="pbar gold"><i style="width:${Math.min(100, (st.cur / st.goal) * 100)}%"></i></div>
      </div>
      <button class="btn btn-sm ${st.done ? 'btn-gold' : 'btn-grey off'}">${st.maxed ? '✓' : `<i class="ic ic-gold"></i> ${st.gold}`}</button>
    </div></div>`).firstElementChild;
    if (st.done) card.querySelector('button').addEventListener('click', () => {
      const r = claimAchv(a);
      if (r) { toast(`+${r.gold} золота`); haptic('success'); refreshOpen(); markDirty(); }
    });
    wrap.appendChild(card);
  }
  return wrap;
}

// ─────────────────────────────────────────────────────────────────────────────
// СЕЙФЫ
// ─────────────────────────────────────────────────────────────────────────────

export function chests() {
  shell('Сейфы', 'Карты супер-менеджеров, золото и наличные', chestsView);
}

function chestsView() {
  const wrap = document.createElement('div');

  // вход по дням
  const day = loginDay();
  const login = h(`<div class="card" style="border-color:var(--gold)">
    <div class="t1" style="margin-bottom:6px">Ежедневный вход · день ${day}</div>
    <div class="grid3" style="grid-template-columns:repeat(7,1fr);gap:4px">
      ${DAILY_LOGIN.map((d, k) => {
        const passed = k + 1 < day || (!loginAvailable() && k + 1 === day);
        const cur = k + 1 === day && loginAvailable();
        return `<div style="text-align:center;padding:5px 1px;border-radius:9px;
          background:${cur ? 'linear-gradient(180deg,#ffe9a8,#ffd35e)' : passed ? 'rgba(76,194,90,.18)' : 'rgba(20,40,65,.07)'};
          border:1.5px solid ${cur ? '#e09a12' : 'transparent'}">
          <div style="font-size:9px;color:#4a6076">${k + 1}</div>
          <div style="font-size:15px">${passed ? '✅' : loginIcon(d)}</div>
        </div>`;
      }).join('')}
    </div>
    <button class="btn btn-wide ${loginAvailable() ? 'btn-gold' : 'btn-grey off'}">
      ${loginAvailable() ? 'Забрать награду дня' : 'Приходите завтра'}</button>
  </div>`).firstElementChild;
  if (loginAvailable()) login.querySelector('button').addEventListener('click', () => {
    const r = claimLogin();
    if (r) {
      const chest = r.got.find((g) => g.kind === 'chest');
      if (chest) { const loot = openChestFree(chest.id); if (loot) chestResult(loot); }
      else toast(`Награда: ${r.got.map(lootLabel).join(', ')}`);
      haptic('success'); refreshOpen(); markDirty();
    }
  });
  wrap.appendChild(login);

  for (const c of Object.values(CHESTS)) {
    const ready = chestReady(c.id);
    const left = chestLeft(c.id);
    const canBuy = c.gold ? S.gold >= c.gold : ready;
    const card = h(`<div class="card chestcard">
      <img src="assets/tasks/${c.art}.png" alt="">
      <div class="t1">${esc(c.name)}</div>
      <div class="t2">${c.cards} ${plural(c.cards, 'карта', 'карты', 'карт')} · наличные · золото</div>
      <button class="btn btn-wide ${canBuy ? (c.gold ? 'btn-gold' : 'btn-sm') : 'btn-grey off'}"
        style="${canBuy && !c.gold ? 'background:linear-gradient(180deg,#63d46f,#2f8c39);border-color:#2b7c33' : ''}">
        ${c.gold ? `<i class="ic ic-gold"></i> ${c.gold}` : ready ? 'Открыть бесплатно' : clock(left)}
      </button>
    </div>`).firstElementChild;
    if (canBuy) card.querySelector('button').addEventListener('click', () => {
      const loot = openChest(c.id);
      if (!loot) { toast('Недоступно'); return; }
      haptic('success');
      chestResult(loot);
      markDirty();
    });
    wrap.appendChild(card);
  }
  return wrap;
}

function loginIcon(d) {
  if (d.type === 'cash') return '💵';
  if (d.type === 'gold') return '<i class="ic ic-gold"></i>';
  if (d.type === 'boost') return '⚡';
  return '🎁';
}

function plural(n, a, b, c) {
  const m = n % 100;
  if (m >= 11 && m <= 14) return c;
  const k = n % 10;
  return k === 1 ? a : k >= 2 && k <= 4 ? b : c;
}

export function chestResult(loot) {
  const cards = loot.filter((l) => l.kind === 'card');
  const html = `
    <div style="text-align:center;padding:4px 0 10px">
      <div style="font-size:44px">🎉</div>
      <div class="t1" style="font-size:15px;margin-top:2px">Содержимое сейфа</div>
    </div>
    ${loot.filter((l) => l.kind !== 'card').map((l) => `
      <div class="card"><div class="row">
        <div class="row-ic">${l.kind === 'gold' ? '<i class="ic ic-gold"></i>' : '💵'}</div>
        <div class="grow"><div class="t1">${l.kind === 'gold' ? int(l.amount) + ' золота' : money(l.amount)}</div></div>
      </div></div>`).join('')}
    <div class="grid3">
      ${cards.map((c) => {
        const def = SUPER_MANAGERS.find((m) => m.id === c.id);
        const r = RARITY[def.rarity];
        return `<div class="smc"><div class="rar" style="background:${r.color}"></div>
          ${c.isNew ? '<div class="lv" style="background:#4cc25a">NEW</div>' : `<div class="lv">+${c.shards}</div>`}
          <div class="smc-art"><img src="assets/char/${def.art}_0.png" alt=""></div>
          <b>${esc(def.name)}</b>
          <div class="bon">${r.name}${c.levelUp ? ' · уровень!' : ''}</div>
        </div>`;
      }).join('')}
    </div>
    <button class="btn btn-wide btn-blue" id="chestOk" style="margin-top:12px">Отлично</button>`;
  const m = openModal({ title: 'Сейф открыт', body: html });
  m.body.querySelector('#chestOk').addEventListener('click', () => { closeModal(); });
}

// ─────────────────────────────────────────────────────────────────────────────
// КАДРЫ (супер-менеджеры)
// ─────────────────────────────────────────────────────────────────────────────

export function staff() {
  shell('Кадры', 'Супер-менеджеры усиливают весь банк', staffView);
}

function bonusText(kind, v) {
  const map = {
    floorSpeed: 'к скорости отделов', floorCap: 'к сумме за ходку',
    elevAll: 'к пропускной способности лифта', vaultAll: 'к скорости хранилища',
    allIncome: 'к доходу', offline: 'к оффлайн-доходу', tapValue: 'к ручному обслуживанию',
    costCut: 'к скидке на улучшения',
  };
  return `${pct(v)} ${map[kind] || ''}`;
}

function staffView() {
  const wrap = document.createElement('div');

  // Слоты
  const slots = document.createElement('div');
  slots.className = 'slotbox';
  for (let i = 0; i < SM_SLOTS.length; i++) {
    const locked = i >= S.sm.slots;
    const id = S.sm.equipped[i];
    const def = id && SUPER_MANAGERS.find((m) => m.id === id);
    const el = h(`<div class="slot ${def ? 'filled' : ''}">
      ${locked ? `<div style="text-align:center"><div class="lk">🔒</div><div><i class="ic ic-gold"></i> ${SM_SLOTS[i].gold}</div></div>`
        : def ? `<img src="assets/char/${def.art}_0.png" alt="">` : '<div>пусто</div>'}
    </div>`).firstElementChild;
    if (locked) {
      el.addEventListener('click', () => {
        if (i !== S.sm.slots) { toast('Сначала откройте предыдущий слот'); return; }
        if (unlockSmSlot()) { toast('Слот открыт'); haptic('success'); refreshOpen(); markDirty(); }
        else toast('Не хватает золота');
      });
    } else if (def) {
      el.addEventListener('click', () => { unequipSm(i); refreshOpen(); markDirty(); });
    }
    slots.appendChild(el);
  }
  wrap.appendChild(h('<div class="t2" style="margin:0 2px 5px">Активные слоты — нажмите, чтобы снять</div>'));
  wrap.appendChild(slots);

  // Суммарные бонусы
  const B = bonuses();
  wrap.appendChild(h(`<div class="card"><div class="t1" style="margin-bottom:4px">Текущие бонусы банка</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">
      <span class="pill green">Доход ${pct(B.allIncome - 1)}</span>
      <span class="pill">Скорость ${pct(B.floorSpeed - 1)}</span>
      <span class="pill">Сумма ${pct(B.floorCap - 1)}</span>
      <span class="pill">Лифт ${pct(B.elevAll - 1)}</span>
      <span class="pill">Хранилище ${pct(B.vaultAll - 1)}</span>
      <span class="pill">Оффлайн ${pct(B.offline - 1)}</span>
      <span class="pill">Скидка ${pct(B.costCut)}</span>
    </div></div>`));

  // Коллекция
  wrap.appendChild(h('<div class="t2" style="margin:10px 2px 6px">Коллекция</div>'));
  const grid = document.createElement('div');
  grid.className = 'grid3';
  for (const def of SUPER_MANAGERS) {
    const card = S.sm.cards[def.id];
    const r = RARITY[def.rarity];
    const eq = S.sm.equipped.indexOf(def.id) >= 0;
    const need = card ? smNeed(def.id) : 0;
    const el = h(`<div class="smc ${card ? '' : 'locked'} ${eq ? 'on' : ''}">
      <div class="rar" style="background:${r.color}"></div>
      ${card ? `<div class="lv">ур. ${card.level}</div>` : ''}
      <div class="smc-art"><img src="assets/char/${def.art}_0.png" alt=""></div>
      <b>${esc(def.name)}</b>
      <div class="bon">${card ? bonusText(def.bonus.kind, smPower(def.id)) : r.name}</div>
      ${card && need ? `<div class="pbar gold" style="margin-top:3px"><i style="width:${Math.min(100, card.shards / need * 100)}%"></i></div>
        <div class="bon">${card.shards}/${need}</div>` : ''}
    </div>`).firstElementChild;
    if (card) el.addEventListener('click', () => equipDialog(def));
    else el.addEventListener('click', () => toast(`${def.name}: ${r.name}. Ищите в сейфах`));
    grid.appendChild(el);
  }
  wrap.appendChild(grid);
  return wrap;
}

function equipDialog(def) {
  const cur = S.sm.equipped.indexOf(def.id);
  if (cur >= 0) { unequipSm(cur); toast('Снят со смены'); refreshOpen(); markDirty(); return; }
  let slot = S.sm.equipped.findIndex((x, i) => i < S.sm.slots && !x);
  if (slot < 0) slot = 0;
  if (S.sm.slots === 0) { toast('Нет доступных слотов'); return; }
  equipSm(def.id, slot);
  toast(`${def.name} вышел на смену`);
  haptic('success');
  refreshOpen(); markDirty();
}

// ─────────────────────────────────────────────────────────────────────────────
// МАГАЗИН
// ─────────────────────────────────────────────────────────────────────────────

export function shop() {
  const m = openModal({
    title: 'Магазин', sub: 'Золото, предложения и бусты',
    tabs: [
      { label: 'Золото', render: goldView },
      { label: 'Наборы', render: offersView },
      { label: 'Бусты', render: boostsView },
    ],
  });
  live = () => {
    if (!document.body.contains(m.body)) { live = null; return; }
    const on = m.sheet.querySelector('.tabs .on');
    const idx = [...m.sheet.querySelectorAll('.tabs button')].indexOf(on);
    const rend = [goldView, offersView, boostsView][idx] || goldView;
    const y = m.body.scrollTop;
    m.body.innerHTML = ''; m.body.appendChild(rend()); m.body.scrollTop = y;
  };
}

function goldView() {
  const wrap = document.createElement('div');
  wrap.appendChild(h(`<div class="card"><div class="row">
    <div class="row-ic"><i class="ic ic-gold"></i></div><div class="grow"><div class="t1">Ваше золото: ${int(S.gold)}</div>
    <div class="t2">Золото ускоряет банк: сейфы, бусты, слоты кадров</div></div></div></div>`));
  const grid = document.createElement('div');
  grid.className = 'grid2';
  for (const p of SHOP_GOLD) {
    const el = h(`<div class="card" style="text-align:center;position:relative;${p.best ? 'border-color:var(--gold)' : ''}">
      ${p.tag ? `<span class="pill gold" style="position:absolute;top:6px;right:6px">${p.tag}</span>` : ''}
      <img src="assets/ui/${p.art}.png" style="width:64px;height:64px;object-fit:contain;margin:2px auto 4px">
      <div class="t1"><i class="ic ic-gold"></i> ${int(p.gold)}</div>
      <button class="btn btn-sm btn-blue" style="width:100%;margin-top:6px">⭐ ${p.stars}</button>
    </div>`).firstElementChild;
    el.querySelector('button').addEventListener('click', () => pay({ kind: 'gold', id: p.id, stars: p.stars, title: `${p.gold} золота`, give: { gold: p.gold } }));
    grid.appendChild(el);
  }
  wrap.appendChild(grid);
  wrap.appendChild(h(`<div class="t2" style="text-align:center;margin-top:10px;opacity:.75">
    Оплата — звёздами Telegram</div>`));
  return wrap;
}

function offersView() {
  const wrap = document.createElement('div');
  for (const o of SHOP_OFFERS) {
    const bought = o.once && S.stats[`offer_${o.id}`];
    const el = h(`<div class="card"><div class="row">
      <div class="row-ic">🎁</div>
      <div class="grow"><div class="t1">${esc(o.title)}</div><div class="t2">${esc(o.desc)}</div></div>
      <button class="btn btn-sm ${bought ? 'btn-grey off' : 'btn-blue'}">${bought ? 'Куплено' : `⭐ ${o.stars}`}</button>
    </div></div>`).firstElementChild;
    if (!bought) el.querySelector('button').addEventListener('click', () => pay({ kind: 'offer', id: o.id, stars: o.stars, title: o.title, give: o.give, once: o.once }));
    wrap.appendChild(el);
  }
  return wrap;
}

function boostsView() {
  const wrap = document.createElement('div');
  for (const b of Object.values(BOOSTS)) {
    const left = boostLeft(b.id);
    const freeLeft = boostFreeLeft(b.id);
    const el = h(`<div class="card"><div class="row">
      <div class="row-ic">${b.icon}</div>
      <div class="grow"><div class="t1">${esc(b.name)}${left > 0 ? ` <span class="pill green">${clock(left)}</span>` : ''}</div>
        <div class="t2">${esc(b.desc)}${b.dur ? ` · ${dur(b.dur)}` : ''}</div></div>
      <div style="display:flex;flex-direction:column;gap:4px">
        <button class="btn btn-sm ${freeLeft > 0 ? 'btn-grey off' : ''}" style="${freeLeft > 0 ? '' : 'background:linear-gradient(180deg,#63d46f,#2f8c39);border-color:#2b7c33'}">
          ${freeLeft > 0 ? clock(freeLeft) : 'Бесплатно'}</button>
        <button class="btn btn-sm ${S.gold >= b.gold ? 'btn-gold' : 'btn-grey off'}"><i class="ic ic-gold"></i> ${b.gold}</button>
      </div>
    </div></div>`).firstElementChild;
    const [freeBtn, goldBtn] = el.querySelectorAll('button');
    if (freeLeft <= 0) freeBtn.addEventListener('click', () => {
      if (claimFreeBoost(b.id)) { toast(`${b.name} активирован`); haptic('success'); refreshOpen(); markDirty(); }
    });
    if (S.gold >= b.gold) goldBtn.addEventListener('click', () => {
      if (activateBoost(b.id)) { toast(`${b.name} активирован`); haptic('success'); refreshOpen(); markDirty(); }
      else toast('Не хватает золота');
    });
    wrap.appendChild(el);
  }
  // оффлайн-потолок
  wrap.appendChild(h('<div class="t2" style="margin:10px 2px 6px">Оффлайн-доход</div>'));
  const cap = offlineCapSeconds() / 3600;
  const cost = offlineCapUpCost();
  const off = h(`<div class="card"><div class="row">
    <div class="row-ic">🌙</div>
    <div class="grow"><div class="t1">Копится ${cap} ч</div>
      <div class="t2">Пока вы не в игре, банк работает и копит доход${cap >= OFFLINE.maxCapHours ? ' (максимум)' : ''}</div></div>
    <button class="btn btn-sm ${cap < OFFLINE.maxCapHours && S.gold >= cost ? 'btn-gold' : 'btn-grey off'}">
      ${cap >= OFFLINE.maxCapHours ? 'MAX' : `<i class="ic ic-gold"></i> ${cost}`}</button>
  </div></div>`).firstElementChild;
  if (cap < OFFLINE.maxCapHours && S.gold >= cost) off.querySelector('button').addEventListener('click', () => {
    if (upgradeOfflineCap()) { toast('Потолок оффлайна увеличен'); haptic('success'); refreshOpen(); markDirty(); }
  });
  wrap.appendChild(off);
  return wrap;
}

export function boosts() { shop(); setTimeout(() => {
  const btns = document.querySelectorAll('.tabs button');
  if (btns[2]) btns[2].click();
}, 0); }

// ─────────────────────────────────────────────────────────────────────────────
// БАНКИ (города)
// ─────────────────────────────────────────────────────────────────────────────

export function banks() {
  shell('Банки', 'Каждый новый город приносит кратно больше', banksView);
}

function banksView() {
  const wrap = document.createElement('div');
  BANKS.forEach((def, i) => {
    const st = S.banks[i];
    const prevOpen = i === 0 || S.banks[i - 1].open;
    const cur = i === S.bankIdx;
    const el = h(`<div class="card" style="${cur ? 'border-color:var(--green);box-shadow:0 0 0 2px rgba(76,194,90,.25)' : ''}">
      <div class="row">
        <div class="row-ic" style="font-size:22px">${def.flag}</div>
        <div class="grow">
          <div class="t1">${esc(def.name)} ${cur ? '<span class="pill green">здесь</span>' : ''}</div>
          <div class="t2">${esc(def.city)} · доход ×${fmt(def.mult)}</div>
          ${st.open ? `<div class="t2">Отделов: ${st.floors.filter((f) => f.lvl > 0).length}/15 · ${money(incomePerSec(i))}/с</div>` : ''}
        </div>
        <button class="btn btn-sm ${st.open ? (cur ? 'btn-grey off' : 'btn-blue') : (prevOpen && S.cash >= def.unlock ? 'btn-gold' : 'btn-grey off')}">
          ${st.open ? (cur ? '✓' : 'Перейти') : prevOpen ? money(def.unlock) : '🔒'}
        </button>
      </div></div>`).firstElementChild;
    const btn = el.querySelector('button');
    if (st.open && !cur) btn.addEventListener('click', () => {
      switchBank(i); scene.scrollToFloor(0, true); scene.clampCam(); closeModal();
      toast(`Вы в банке «${def.name}»`); haptic('medium'); markDirty();
    });
    else if (!st.open && prevOpen && S.cash >= def.unlock) btn.addEventListener('click', () => {
      if (unlockBank(i)) {
        switchBank(i); scene.scrollToFloor(0, true); closeModal();
        toast(`Открыт банк «${def.name}»!`); haptic('success'); markDirty();
      }
    });
    wrap.appendChild(el);
  });
  return wrap;
}

// ─────────────────────────────────────────────────────────────────────────────
// РЕНОВАЦИЯ И СОВЕТ ДИРЕКТОРОВ
// ─────────────────────────────────────────────────────────────────────────────

export function renovation() {
  const m = openModal({
    title: 'Реновация', sub: 'Перезапуск сети ради постоянных бонусов',
    tabs: [
      { label: 'Реновация', render: renovView },
      { label: 'Совет директоров', render: boardView },
    ],
  });
  live = () => {
    if (!document.body.contains(m.body)) { live = null; return; }
    const on = m.sheet.querySelector('.tabs .on');
    const idx = [...m.sheet.querySelectorAll('.tabs button')].indexOf(on);
    const rend = [renovView, boardView][idx] || renovView;
    const y = m.body.scrollTop;
    m.body.innerHTML = ''; m.body.appendChild(rend()); m.body.scrollTop = y;
  };
}

function renovView() {
  const wrap = document.createElement('div');
  const gain = renovationShares();
  const can = canRenovate();
  wrap.appendChild(h(`<div class="card" style="text-align:center">
    <div style="font-size:40px">📜</div>
    <div class="t1" style="font-size:15px">Акции: ${int(S.shares)}</div>
    <div class="t2">Каждая акция даёт ${pct(PRESTIGE.bonusPerShare)} к доходу навсегда.<br>
      Сейчас бонус: <b>${pct(S.shares * PRESTIGE.bonusPerShare)}</b></div>
  </div>`));
  wrap.appendChild(h(`<div class="card">
    <div class="t1">Что происходит при реновации</div>
    <div class="t2" style="margin-top:4px">
      • Все банки, отделы, менеджеры и наличные обнуляются<br>
      • Вы получаете акции за заработанное<br>
      • Золото, карты кадров, достижения и апгрейды совета сохраняются
    </div>
  </div>`));
  const box = h(`<div class="card" style="border-color:var(--gold)">
    <div class="row"><div class="row-ic">📈</div><div class="grow">
      <div class="t1">Получите ${int(gain)} ${plural(gain, 'акцию', 'акции', 'акций')}</div>
      <div class="t2">Заработано за забег: ${money(S.stats.runEarned)}${can ? '' : ` · нужно ${money(PRESTIGE.minEarned)}`}</div>
    </div></div>
    <button class="btn btn-wide ${can ? 'btn-red' : 'btn-grey off'}">Провести реновацию</button>
  </div>`).firstElementChild;
  if (can) box.querySelector('button').addEventListener('click', () => confirmRenovate(gain));
  wrap.appendChild(box);
  return wrap;
}

function confirmRenovate(gain) {
  const m = openModal({
    title: 'Точно реновация?',
    body: `<div class="card"><div class="t2">Весь прогресс банков будет сброшен. Вы получите
      <b>${int(gain)} ${plural(gain, 'акцию', 'акции', 'акций')}</b> и постоянный бонус
      <b>${pct(gain * PRESTIGE.bonusPerShare)}</b> к доходу.</div></div>
      <button class="btn btn-wide btn-red" id="doRen">Да, перезапустить сеть</button>
      <button class="btn btn-wide btn-grey" id="noRen" style="margin-top:6px">Отмена</button>`,
  });
  m.body.querySelector('#doRen').addEventListener('click', () => {
    const got = renovate();
    closeModal();
    scene.scrollToFloor(0, true);
    toast(`Реновация завершена. +${int(got)} акций`);
    haptic('success');
    markDirty();
  });
  m.body.querySelector('#noRen').addEventListener('click', () => closeModal());
}

function boardView() {
  const wrap = document.createElement('div');
  wrap.appendChild(h(`<div class="card"><div class="row"><div class="row-ic">📜</div>
    <div class="grow"><div class="t1">Свободных акций: ${int(S.shares)}</div>
    <div class="t2">Апгрейды совета действуют вечно и не сбрасываются</div></div></div></div>`));
  for (const u of BOARD_UPGRADES) {
    const lvl = S.board[u.id] || 0;
    const cost = boardCost(u);
    const maxed = lvl >= u.max;
    const can = !maxed && S.shares >= cost;
    const el = h(`<div class="card"><div class="row">
      <div class="row-ic">⚙️</div>
      <div class="grow"><div class="t1">${esc(u.title)} <span class="pill">${lvl}/${u.max}</span></div>
        <div class="t2">${esc(u.desc)}</div>
        <div class="pbar gold"><i style="width:${(lvl / u.max) * 100}%"></i></div></div>
      <button class="btn btn-sm ${can ? 'btn-gold' : 'btn-grey off'}">${maxed ? 'MAX' : `📜 ${cost}`}</button>
    </div></div>`).firstElementChild;
    if (can) el.querySelector('button').addEventListener('click', () => {
      if (buyBoard(u)) { toast(`${u.title} улучшено`); haptic('success'); refreshOpen(); markDirty(); }
    });
    wrap.appendChild(el);
  }
  return wrap;
}

// ─────────────────────────────────────────────────────────────────────────────
// МЕНЕДЖЕР
// ─────────────────────────────────────────────────────────────────────────────

export function manager(kind, i = 0) {
  const b = bank();
  const u = kind === 'floor' ? b.floors[i] : kind === 'elev' ? b.elev : b.vault;
  const name = kind === 'floor' ? FLOOR_DEFS[i].name : kind === 'elev' ? 'Лифт' : 'Хранилище';
  const cost = kind === 'floor' ? floorMgrCost(i) : kind === 'elev' ? elevMgrCost() : vaultMgrCost();
  if (u.mgr) {
    openModal({
      title: 'Менеджер на месте', body: `<div class="card"><div class="row">
        <div class="row-ic">✅</div><div class="grow"><div class="t1">${esc(name)}</div>
        <div class="t2">Работает автоматически, в том числе пока вы не в игре.</div></div></div></div>`,
    });
    return;
  }
  const m = openModal({
    title: 'Нанять менеджера',
    body: `<div class="card"><div class="row">
        <div class="row-ic">👔</div>
        <div class="grow"><div class="t1">${esc(name)}</div>
        <div class="t2">Объект начнёт работать сам — без нажатий и даже офлайн.</div></div></div></div>
      <button class="btn btn-wide ${S.cash >= cost ? '' : 'btn-grey off'}" id="hire"
        style="${S.cash >= cost ? 'background:linear-gradient(180deg,#63d46f,#2f8c39);border:1.5px solid #2b7c33' : ''}">
        Нанять · ${money(cost)}</button>`,
  });
  const btn = m.body.querySelector('#hire');
  if (S.cash >= cost) btn.addEventListener('click', () => {
    const ok = kind === 'floor' ? hireFloorMgr(i) : kind === 'elev' ? hireElevMgr() : hireVaultMgr();
    if (ok) { closeModal(); toast(`${name}: менеджер нанят`); haptic('success'); markDirty(); }
    else toast('Не хватает денег');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ОФФЛАЙН
// ─────────────────────────────────────────────────────────────────────────────

export function offline(p) {
  const m = openModal({
    title: 'Банк работал без вас',
    body: `<div class="card" style="text-align:center">
        <div style="font-size:40px">🌙</div>
        <div class="t1" style="font-size:16px">${money(p.amount)}</div>
        <div class="t2">За ${dur(p.seconds)}${p.capped ? ` (потолок ${offlineCapSeconds() / 3600} ч)` : ''}</div>
      </div>
      ${p.capped ? `<div class="card"><div class="t2">Увеличить потолок можно во вкладке «Бусты» магазина.</div></div>` : ''}
      <button class="btn btn-wide" id="take" style="background:linear-gradient(180deg,#63d46f,#2f8c39);border:1.5px solid #2b7c33">Забрать</button>
      <button class="btn btn-wide btn-gold" id="dbl" style="margin-top:6px">Удвоить · <i class="ic ic-gold"></i> ${OFFLINE.doubleGold}</button>`,
  });
  m.body.querySelector('#take').addEventListener('click', () => {
    const v = claimOffline(false); closeModal();
    if (v) { toast(`+${money(v)}`); haptic('success'); markDirty(); }
  });
  m.body.querySelector('#dbl').addEventListener('click', () => {
    if (S.gold < OFFLINE.doubleGold) { toast('Не хватает золота'); return; }
    const v = claimOffline(true); closeModal();
    if (v) { toast(`+${money(v)}`); haptic('success'); markDirty(); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// НАСТРОЙКИ И СТАТИСТИКА
// ─────────────────────────────────────────────────────────────────────────────

export function settings() {
  shell('Настройки', '', settingsView);
}

function settingsView() {
  const wrap = document.createElement('div');
  const st = S.stats;
  const toggles = [
    ['haptics', 'Вибрация'],
    ['showFx', 'Эффекты и анимации'],
    ['sound', 'Звук'],
  ];
  for (const [k, label] of toggles) {
    const el = h(`<div class="card"><div class="row">
      <div class="row-ic">${k === 'haptics' ? '📳' : k === 'showFx' ? '✨' : '🔊'}</div>
      <div class="grow"><div class="t1">${label}</div></div>
      <button class="btn btn-sm ${S.settings[k] ? '' : 'btn-grey'}"
        style="${S.settings[k] ? 'background:linear-gradient(180deg,#63d46f,#2f8c39);border-color:#2b7c33' : ''}">
        ${S.settings[k] ? 'Вкл' : 'Выкл'}</button>
    </div></div>`).firstElementChild;
    el.querySelector('button').addEventListener('click', () => {
      S.settings[k] = !S.settings[k]; save(); refreshOpen();
    });
    wrap.appendChild(el);
  }

  wrap.appendChild(h(`<div class="t2" style="margin:10px 2px 6px">Статистика</div>
    <div class="card">
      ${statRow('Всего заработано', money(st.totalEarned))}
      ${statRow('За текущий забег', money(st.runEarned))}
      ${statRow('Улучшений', int(st.upgrades))}
      ${statRow('Ручных обслуживаний', int(st.taps))}
      ${statRow('Менеджеров нанято', int(st.managers))}
      ${statRow('Отделов открыто', int(st.floorsOpen))}
      ${statRow('Банков открыто', int(st.banksOpen))}
      ${statRow('Вех достигнуто', int(st.milestones))}
      ${statRow('Реноваций', int(st.renovations))}
      ${statRow('Сейфов открыто', int(st.chests || 0))}
      ${statRow('Уровень игрока', int(S.level))}
    </div>`));

  const reset = h(`<button class="btn btn-wide btn-red" style="margin-top:8px">Сбросить весь прогресс</button>`).firstElementChild;
  reset.addEventListener('click', () => {
    const m = openModal({
      title: 'Сбросить прогресс?',
      body: `<div class="card"><div class="t2">Будет удалено всё: банки, золото, карты, акции и достижения.
        Отменить это нельзя.</div></div>
        <button class="btn btn-wide btn-red" id="yes">Да, удалить всё</button>
        <button class="btn btn-wide btn-grey" id="no" style="margin-top:6px">Отмена</button>`,
    });
    m.body.querySelector('#yes').addEventListener('click', () => {
      localStorage.removeItem('idlebank_save_v1');
      location.reload();
    });
    m.body.querySelector('#no').addEventListener('click', () => closeModal());
  });
  wrap.appendChild(reset);

  wrap.appendChild(h(`<div class="t2" style="text-align:center;margin-top:12px;opacity:.6">
    Idle Bank Tycoon · сборка ${new Date(S.created).getFullYear()}</div>`));
  return wrap;
}

function statRow(a, b) {
  return `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11.5px">
    <span style="color:var(--ink2)">${a}</span><b>${b}</b></div>`;
}

// ─────────────────────────────────────────────────────────────────────────────

export function levelUp(lvl) {
  const m = openModal({
    title: 'Новый уровень!',
    body: `<div class="card" style="text-align:center">
      <div style="font-size:44px">🎉</div>
      <div class="t1" style="font-size:17px">Уровень ${lvl}</div>
      <div class="t2">Награда зачислена на счёт</div>
    </div><button class="btn btn-wide btn-blue" id="ok">Продолжить</button>`,
  });
  m.body.querySelector('#ok').addEventListener('click', () => closeModal());
}

export const screens = {
  tasks, chests, staff, shop, banks, renovation, settings, manager, offline,
  chestResult, levelUp, boosts, refreshOpen,
};
