// Все балансные числа игры. В остальном коде магических констант быть не должно.

// ─────────────────────────────────────────────────────────────────────────────
// ОТДЕЛЫ БАНКА (аналог шахт в Idle Miner / этажей в Idle Bank Tycoon)
// ─────────────────────────────────────────────────────────────────────────────

export const FLOOR_DEFS = [
  { id: 'deposits',  name: 'Приём вкладов',     short: 'Вклады',     icon: '🏦', hue: 205 },
  { id: 'loans',     name: 'Кредитный отдел',   short: 'Кредиты',    icon: '📄', hue: 145 },
  { id: 'exchange',  name: 'Обмен валют',       short: 'Валюта',     icon: '💱', hue: 35  },
  { id: 'mortgage',  name: 'Ипотека',           short: 'Ипотека',    icon: '🏠', hue: 255 },
  { id: 'auto',      name: 'Автокредиты',       short: 'Авто',       icon: '🚗', hue: 12  },
  { id: 'safe',      name: 'Депозитарий',       short: 'Ячейки',     icon: '🔐', hue: 190 },
  { id: 'insurance', name: 'Страхование',       short: 'Страховка',  icon: '🛡️', hue: 168 },
  { id: 'invest',    name: 'Инвестиции',        short: 'Инвест',     icon: '📈', hue: 96  },
  { id: 'broker',    name: 'Брокерский отдел',  short: 'Брокер',     icon: '📊', hue: 285 },
  { id: 'private',   name: 'Private Banking',   short: 'Private',    icon: '🥂', hue: 45  },
  { id: 'corp',      name: 'Корпоративный',     short: 'Корпорат',   icon: '🏢', hue: 218 },
  { id: 'wire',      name: 'Межд. переводы',    short: 'SWIFT',      icon: '🌐', hue: 178 },
  { id: 'trading',   name: 'Трейдинг-деск',     short: 'Трейдинг',   icon: '⚡', hue: 320 },
  { id: 'asset',     name: 'Управление активами', short: 'Активы',   icon: '💼', hue: 268 },
  { id: 'crypto',    name: 'Крипто-отдел',      short: 'Крипта',     icon: '₿',  hue: 28  },
];

export const FLOOR_COUNT = FLOOR_DEFS.length;

// Кривые роста.
// Ключевая идея: производительность объекта задаётся не отдельной константой,
// а его окупаемостью — «за сколько секунд объект отобьёт свою цену».
// Так пропорции цена/доход не расходятся на дальних отделах.
export const CURVE = {
  floorUnlockBase: 30,        // цена открытия нулевого отдела (он открыт сразу)
  floorUnlockGrow: 5.6,       // во столько раз дороже каждый следующий отдел
  floorPayback: 30,           // сек: за столько отдел 1-го уровня отбивает цену открытия
  floorUpCostRatio: 0.2,      // цена апгрейда 1→2 относительно цены открытия
  floorUpCostGrow: 1.07,      // рост цены апгрейда за уровень
  // Сумма за уровень растёт чуть медленнее цены. Отдача с вложенного доллара
  // сперва увеличивается за счёт вех, после ~600-го уровня начинает падать —
  // это и есть стена, которая гонит открывать новые отделы, банки и делать реновацию.
  floorCapLevelGrow: 1.067,
  floorTripBase: 3.0,         // секунд на ходку у 1-го отдела
  floorTripStep: 0.25,        // +секунд у каждого следующего отдела
  managerCostRatio: 6,        // цена менеджера отдела = цена открытия × это

  elevCostBase: 55,
  elevCostGrow: 1.058,
  elevCapGrow: 1.055,
  elevTripBase: 7.0,
  elevPayback: 8,             // лифт идёт с запасом — иначе встаёт в первую же минуту
  elevManagerCost: 1200,

  vaultCostBase: 85,
  vaultCostGrow: 1.058,
  vaultCapGrow: 1.055,
  vaultTimeBase: 5.5,
  vaultPayback: 8,
  vaultManagerCost: 3200,

  maxWorkers: 8,              // максимум клерков на этаже
  maxSpeedMult: 8,            // потолок ускорения ходки
  minTripTime: 0.45,          // быстрее клерк ходить не может
};

/** Базовая цена открытия отдела i (без множителя банка и скидок). */
export function floorBase(i) { return CURVE.floorUnlockBase * CURVE.floorUnlockGrow ** i; }
/** Время одной ходки клерка на отделе i. */
export function floorTrip(i) { return CURVE.floorTripBase + CURVE.floorTripStep * i; }
/** Сумма, которую клерк отдела i несёт за ходку на 1-м уровне. */
export function floorCapBase(i) { return (floorBase(i) / CURVE.floorPayback) * floorTrip(i); }
export function elevCapBase() { return (CURVE.elevCostBase / CURVE.elevPayback) * CURVE.elevTripBase; }
export function vaultCapBase() { return (CURVE.vaultCostBase / CURVE.vaultPayback) * CURVE.vaultTimeBase; }

// Вехи уровней: дают клерка, ускорение или удвоение суммы.
// После последней записи цикл продолжается каждые MILESTONE_STEP уровней.
export const MILESTONES = [
  { lvl: 10,   type: 'worker' },
  { lvl: 25,   type: 'speed'  },
  { lvl: 50,   type: 'cap'    },
  { lvl: 100,  type: 'worker' },
  { lvl: 150,  type: 'speed'  },
  { lvl: 200,  type: 'cap'    },
  { lvl: 300,  type: 'worker' },
  { lvl: 400,  type: 'speed'  },
  { lvl: 500,  type: 'cap'    },
  { lvl: 750,  type: 'worker' },
  { lvl: 1000, type: 'speed'  },
];
// После списка вехи повторяются с ГЕОМЕТРИЧЕСКИМ шагом (каждая следующая на 30 %
// дальше предыдущей). Если бы шаг был постоянным, число вех росло бы линейно
// с уровнем, а бонус ×2 за каждую — экспоненциально: экономика сгорала за часы.
export const MILESTONE_GEOM = 1.45;
export const MILESTONE_CYCLE = ['cap', 'worker', 'speed'];
export const MILESTONE_EFFECT = {
  speed: 1.25,   // множитель скорости ходки
  cap: 2,        // множитель переносимой суммы
  worker: 1,     // +1 клерк (сверх максимума превращается в ×2 к сумме)
};
export const MAX_LEVEL = 1e6;               // страховка от разгона чисел

const LAST_FIXED = MILESTONES[MILESTONES.length - 1].lvl;
function stepAfter(lvl) { return Math.max(lvl + 10, Math.round(lvl * MILESTONE_GEOM / 10) * 10); }

/** Все вехи до уровня lvl включительно. */
export function milestonesUpTo(lvl) {
  const out = [];
  for (const m of MILESTONES) if (lvl >= m.lvl) out.push(m);
  let cur = LAST_FIXED;
  let k = 0;
  while (true) {
    cur = stepAfter(cur);
    if (lvl < cur) break;
    out.push({ lvl: cur, type: MILESTONE_CYCLE[k % 3] });
    k++;
  }
  return out;
}

/** Следующая веха после уровня lvl. */
export function nextMilestone(lvl) {
  for (const m of MILESTONES) if (m.lvl > lvl) return m;
  let cur = LAST_FIXED;
  let k = 0;
  while (true) {
    cur = stepAfter(cur);
    if (lvl < cur) return { lvl: cur, type: MILESTONE_CYCLE[k % 3] };
    k++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// БАНКИ (города). Каждый — отдельный прогресс со своим множителем.
// ─────────────────────────────────────────────────────────────────────────────

export const BANKS = [
  { id: 'downtown',  name: 'Городской банк', city: 'Старый центр', mult: 1,      unlock: 0,      sky: ['#7ec8f2', '#c9e9fb'], accent: '#3f7fd6', flag: '🏙️' },
  { id: 'metropolis',name: 'Метрополис',     city: 'Деловой район',mult: 1e3,     unlock: 1e8,  sky: ['#5aa9e6', '#bfe3fa'], accent: '#2f6fc4', flag: '🌆' },
  { id: 'newyork',   name: 'Нью-Йорк',       city: 'Уолл-стрит',   mult: 3e6,  unlock: 3e11, sky: ['#4a7fb5', '#a9cbe8'], accent: '#255a9e', flag: '🗽' },
  { id: 'london',    name: 'Лондон',         city: 'Сити',         mult: 1e10,  unlock: 1e15, sky: ['#8493a6', '#cfd8e3'], accent: '#5a6b80', flag: '🎩' },
  { id: 'tokyo',     name: 'Токио',          city: 'Маруноути',    mult: 4e13,  unlock: 4e18,   sky: ['#d98fb0', '#fadfe9'], accent: '#c2557f', flag: '🌸' },
  { id: 'dubai',     name: 'Дубай',          city: 'Марина',       mult: 1.5e17,  unlock: 1.5e22, sky: ['#f0b46a', '#fbe6c6'], accent: '#c98428', flag: '🏜️' },
  { id: 'singapore', name: 'Сингапур',       city: 'Раффлз-плейс', mult: 6e20, unlock: 6e25, sky: ['#63c9b0', '#c9f0e6'], accent: '#249f83', flag: '🌴' },
  { id: 'zurich',    name: 'Цюрих',          city: 'Банхофштрассе',mult: 2e24, unlock: 2e29, sky: ['#9fb8d8', '#dce7f5'], accent: '#4d6f9e', flag: '🏔️' },
  { id: 'hongkong',  name: 'Гонконг',        city: 'Централ',      mult: 8e27, unlock: 8e32, sky: ['#e08a6a', '#f7dccf'], accent: '#bf5b38', flag: '🏮' },
  { id: 'orbital',   name: 'Орбитальный',    city: 'Станция «Кредит-1»', mult: 3e31, unlock: 3e36, sky: ['#2b2f52', '#4d5691'], accent: '#7d8ce0', flag: '🛰️' },
];

// ─────────────────────────────────────────────────────────────────────────────
// ВАЛЮТЫ, ОПЫТ, УРОВЕНЬ ИГРОКА
// ─────────────────────────────────────────────────────────────────────────────

export const XP = {
  perUpgrade: 3,          // опыт за один уровень апгрейда
  perUnlock: 60,          // за открытие отдела
  perManager: 120,        // за найм менеджера
  perTask: 40,            // за выполненное задание
  base: 120,              // опыт до 2-го уровня
  grow: 1.28,             // рост требования
  goldPerLevel: 8,        // золота за уровень игрока
  goldBonusEvery: 5,      // каждые N уровней — доп. награда
  goldBonus: 40,
};

export function xpForLevel(lvl) {
  return Math.floor(XP.base * XP.grow ** (lvl - 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// БУСТЫ
// ─────────────────────────────────────────────────────────────────────────────

export const BOOSTS = {
  income2x:   { id: 'income2x',   name: 'Доход ×2',        desc: 'Весь доход банка удваивается', mult: 2,  dur: 4 * 3600, gold: 25, freeCd: 30 * 60, icon: '💰' },
  turbo:      { id: 'turbo',      name: 'Турбо ×10',       desc: 'Клерки, лифт и хранилище работают в 10 раз быстрее', mult: 10, dur: 60, gold: 15, freeCd: 15 * 60, icon: '⚡' },
  instant:    { id: 'instant',    name: 'Мгновенный доход',desc: 'Сразу выдаёт 2 часа дохода', hours: 2, gold: 40, freeCd: 60 * 60, icon: '💵' },
};

export const OFFLINE = {
  baseCapHours: 2,        // сколько часов копится доход в оффлайне
  maxCapHours: 24,        // потолок с апгрейдами
  capUpgradeHours: 2,     // +часы за один апгрейд
  capUpgradeGoldBase: 60, // цена апгрейда потолка
  capUpgradeGoldGrow: 1.6,
  rate: 0.6,              // доля от онлайн-дохода
  doubleGold: 30,         // удвоить собранное за золото
};

// ─────────────────────────────────────────────────────────────────────────────
// СУПЕР-МЕНЕДЖЕРЫ (карточки из сундуков)
// ─────────────────────────────────────────────────────────────────────────────

export const RARITY = {
  common:    { id: 'common',    name: 'Обычный',      color: '#8fa7bd', weight: 62, shards: [5, 15, 40, 100],  power: 1 },
  rare:      { id: 'rare',      name: 'Редкий',       color: '#4b9ae8', weight: 26, shards: [4, 12, 30, 80],   power: 1.8 },
  epic:      { id: 'epic',      name: 'Эпический',    color: '#a765e0', weight: 9.5,shards: [3, 9, 24, 60],    power: 3.2 },
  legendary: { id: 'legendary', name: 'Легендарный',  color: '#efa62c', weight: 2.5,shards: [2, 6, 16, 40],    power: 5.5 },
};

// bonus.kind: floorSpeed | floorCap | elevAll | vaultAll | allIncome | offline | tapValue | costCut
export const SUPER_MANAGERS = [
  { id: 'sm_anna',   name: 'Анна Крылова',   role: 'Старший операционист', rarity: 'common',    bonus: { kind: 'floorSpeed', v: 0.06 }, art: 'sw' },
  { id: 'sm_oleg',   name: 'Олег Барсов',    role: 'Кредитный инспектор',  rarity: 'common',    bonus: { kind: 'floorCap',   v: 0.06 }, art: 'se' },
  { id: 'sm_marta',  name: 'Марта Веб',      role: 'Кассир-универсал',     rarity: 'common',    bonus: { kind: 'vaultAll',   v: 0.08 }, art: 'nw' },
  { id: 'sm_ilya',   name: 'Илья Гром',      role: 'Лифтёр-логист',        rarity: 'common',    bonus: { kind: 'elevAll',    v: 0.08 }, art: 'ne' },
  { id: 'sm_dina',   name: 'Дина Соколова',  role: 'Аналитик',             rarity: 'rare',      bonus: { kind: 'allIncome',  v: 0.07 }, art: 'sw' },
  { id: 'sm_viktor', name: 'Виктор Стайн',   role: 'Начальник смены',      rarity: 'rare',      bonus: { kind: 'floorSpeed', v: 0.12 }, art: 'se' },
  { id: 'sm_lena',   name: 'Лена Морозова',  role: 'Инкассатор',           rarity: 'rare',      bonus: { kind: 'elevAll',    v: 0.16 }, art: 'nw' },
  { id: 'sm_pavel',  name: 'Павел Ким',      role: 'Ночной менеджер',      rarity: 'rare',      bonus: { kind: 'offline',    v: 0.20 }, art: 'ne' },
  { id: 'sm_sofia',  name: 'София Ланге',    role: 'Директор по рискам',   rarity: 'epic',      bonus: { kind: 'allIncome',  v: 0.15 }, art: 'sw' },
  { id: 'sm_rashid', name: 'Рашид Наби',     role: 'Глава казначейства',   rarity: 'epic',      bonus: { kind: 'vaultAll',   v: 0.28 }, art: 'se' },
  { id: 'sm_greta',  name: 'Грета Хольм',    role: 'Снабженец',            rarity: 'epic',      bonus: { kind: 'costCut',    v: 0.10 }, art: 'nw' },
  { id: 'sm_max',    name: 'Максим Орлов',   role: 'Трейдер',              rarity: 'legendary', bonus: { kind: 'allIncome',  v: 0.30 }, art: 'ne' },
  { id: 'sm_iren',   name: 'Ирэн Вальд',     role: 'Председатель правления',rarity: 'legendary',bonus: { kind: 'floorCap',   v: 0.35 }, art: 'sw' },
  { id: 'sm_tap',    name: 'Борис Быстров',  role: 'Мастер обслуживания',  rarity: 'legendary', bonus: { kind: 'tapValue',   v: 0.60 }, art: 'se' },
];

export const SM_SLOTS = [
  { slot: 0, gold: 0 },
  { slot: 1, gold: 150 },
  { slot: 2, gold: 600 },
];
// Уровень карты: сила бонуса = base * LEVEL_POWER[level-1]
export const SM_LEVEL_POWER = [1, 1.6, 2.4, 3.4, 4.6];

// ─────────────────────────────────────────────────────────────────────────────
// СУНДУКИ
// ─────────────────────────────────────────────────────────────────────────────

export const CHESTS = {
  free:   { id: 'free',   name: 'Бесплатный сейф', gold: 0,   cd: 4 * 3600, cards: 1, art: 'chest1',
            loot: { cashHours: [0.4, 1.2], gold: [3, 10], rarityBoost: 0 } },
  silver: { id: 'silver', name: 'Серебряный сейф', gold: 60,  cd: 0, cards: 3, art: 'chest2',
            loot: { cashHours: [1.5, 4], gold: [10, 30], rarityBoost: 1 } },
  gold:   { id: 'gold',   name: 'Золотой сейф',    gold: 250, cd: 0, cards: 6, art: 'chest3',
            loot: { cashHours: [5, 12], gold: [40, 110], rarityBoost: 2.6 } },
};

// ─────────────────────────────────────────────────────────────────────────────
// ЕЖЕДНЕВНЫЙ ВХОД (7 дней)
// ─────────────────────────────────────────────────────────────────────────────

export const DAILY_LOGIN = [
  { day: 1, type: 'cash',  hours: 0.5 },
  { day: 2, type: 'gold',  amount: 15 },
  { day: 3, type: 'cash',  hours: 1.5 },
  { day: 4, type: 'boost', boost: 'income2x' },
  { day: 5, type: 'gold',  amount: 40 },
  { day: 6, type: 'chest', chest: 'silver' },
  { day: 7, type: 'gold',  amount: 120 },
];

// ─────────────────────────────────────────────────────────────────────────────
// ЕЖЕДНЕВНЫЕ ЗАДАНИЯ (пул, каждый день выбирается 4)
// ─────────────────────────────────────────────────────────────────────────────
// stat — счётчик из state.stats.daily, goal — цель, reward — награда.

export const DAILY_POOL = [
  { id: 'd_up',      stat: 'upgrades',   goal: 25,  title: 'Улучшить отделы 25 раз',        reward: { gold: 12 } },
  { id: 'd_up2',     stat: 'upgrades',   goal: 80,  title: 'Улучшить отделы 80 раз',        reward: { gold: 30 } },
  { id: 'd_tap',     stat: 'taps',       goal: 60,  title: 'Обслужить 60 клиентов вручную', reward: { cashHours: 0.5 } },
  { id: 'd_earn',    stat: 'earnedRel',  goal: 1,   title: 'Заработать доход за 20 минут',  reward: { gold: 15 }, rel: 20 * 60 },
  { id: 'd_earn2',   stat: 'earnedRel',  goal: 1,   title: 'Заработать доход за час',       reward: { gold: 25 }, rel: 60 * 60 },
  { id: 'd_boost',   stat: 'boosts',     goal: 2,   title: 'Запустить 2 буста',             reward: { gold: 15 } },
  { id: 'd_mgr',     stat: 'managers',   goal: 1,   title: 'Нанять менеджера',              reward: { gold: 20 } },
  { id: 'd_elev',    stat: 'elevUp',     goal: 10,  title: 'Улучшить лифт 10 раз',          reward: { gold: 12 } },
  { id: 'd_vault',   stat: 'vaultUp',    goal: 10,  title: 'Улучшить хранилище 10 раз',     reward: { gold: 12 } },
  { id: 'd_chest',   stat: 'chests',     goal: 1,   title: 'Открыть сейф',                  reward: { cashHours: 1 } },
  { id: 'd_ms',      stat: 'milestones', goal: 1,   title: 'Взять веху отдела',             reward: { gold: 20 } },
  { id: 'd_visit',   stat: 'switches',   goal: 2,   title: 'Заглянуть в 2 банка',           reward: { gold: 10 } },
];
export const DAILY_COUNT = 4;
export const DAILY_ALL_BONUS = { gold: 50, chest: 'silver' };

// ─────────────────────────────────────────────────────────────────────────────
// ДОСТИЖЕНИЯ (многоуровневые, бесконечные)
// ─────────────────────────────────────────────────────────────────────────────

export const ACHIEVEMENTS = [
  { id: 'a_up',    stat: 'upgrades',    title: 'Модернизация',   desc: 'Улучшений отделов',        tiers: [25, 100, 500, 2000, 10000, 50000, 250000], gold: [10, 20, 40, 80, 160, 320, 640] },
  { id: 'a_earn',  stat: 'totalEarned', title: 'Капитал',        desc: 'Всего заработано',         tiers: [1e4, 1e6, 1e9, 1e12, 1e16, 1e21, 1e28],   gold: [10, 25, 50, 100, 200, 400, 800], money: true },
  { id: 'a_floor', stat: 'floorsOpen',  title: 'Расширение',     desc: 'Открыто отделов (всего)',  tiers: [3, 8, 15, 30, 60, 105, 150],              gold: [15, 30, 60, 120, 240, 480, 960] },
  { id: 'a_mgr',   stat: 'managers',    title: 'Кадровый резерв',desc: 'Нанято менеджеров',        tiers: [1, 5, 17, 40, 85, 150, 250],              gold: [15, 30, 60, 120, 240, 480, 960] },
  { id: 'a_tap',   stat: 'taps',        title: 'Ручной труд',    desc: 'Клиентов обслужено вручную',tiers: [100, 1000, 5000, 20000, 75000, 2e5, 5e5],gold: [10, 20, 40, 80, 160, 320, 640] },
  { id: 'a_bank',  stat: 'banksOpen',   title: 'Финансовая сеть',desc: 'Открыто банков',           tiers: [2, 3, 4, 5, 6, 8, 10],                    gold: [25, 50, 100, 200, 400, 800, 1600] },
  { id: 'a_ren',   stat: 'renovations', title: 'Реновация',      desc: 'Проведено реноваций',      tiers: [1, 3, 8, 20, 50, 120, 300],               gold: [40, 80, 160, 320, 640, 1280, 2560] },
  { id: 'a_ms',    stat: 'milestones',  title: 'Вехи',           desc: 'Достигнуто вех',           tiers: [5, 25, 75, 200, 500, 1200, 3000],         gold: [15, 30, 60, 120, 240, 480, 960] },
  { id: 'a_lvl',   stat: 'maxFloorLvl', title: 'Флагман',        desc: 'Максимальный уровень отдела',tiers: [25, 50, 100, 200, 400, 700, 1000],      gold: [15, 30, 60, 120, 240, 480, 960] },
  { id: 'a_sm',    stat: 'smCards',     title: 'Коллекционер',   desc: 'Собрано супер-менеджеров', tiers: [1, 3, 6, 9, 12, 14, 14],                  gold: [25, 50, 100, 200, 400, 800, 1600] },
];

// ─────────────────────────────────────────────────────────────────────────────
// КОНТРАКТЫ БАНКА — сюжетная цепочка заданий текущего банка
// ─────────────────────────────────────────────────────────────────────────────
// check(bank, state) выполняется движком; goal/progress вычисляются там же.

export const CONTRACTS = [
  { id: 'c1',  title: 'Открыть приём вкладов',        kind: 'floorsOpen',  goal: 1,    reward: { gold: 10 } },
  { id: 'c2',  title: 'Поднять любой отдел до 5 ур.', kind: 'anyFloorLvl', goal: 5,    reward: { gold: 10 } },
  { id: 'c3',  title: 'Открыть 2 отдела',             kind: 'floorsOpen',  goal: 2,    reward: { gold: 15 } },
  { id: 'c4',  title: 'Улучшить лифт до 10 ур.',      kind: 'elevLvl',     goal: 10,   reward: { gold: 15 } },
  { id: 'c5',  title: 'Нанять первого менеджера',     kind: 'managers',    goal: 1,    reward: { gold: 25 } },
  { id: 'c6',  title: 'Открыть 4 отдела',             kind: 'floorsOpen',  goal: 4,    reward: { gold: 25 } },
  { id: 'c7',  title: 'Хранилище до 25 ур.',          kind: 'vaultLvl',    goal: 25,   reward: { gold: 30 } },
  { id: 'c8',  title: 'Взять 3 вехи',                 kind: 'milestones',  goal: 3,    reward: { gold: 30 } },
  { id: 'c9',  title: 'Открыть 6 отделов',            kind: 'floorsOpen',  goal: 6,    reward: { gold: 40 } },
  { id: 'c10', title: 'Отдел до 50 уровня',           kind: 'anyFloorLvl', goal: 50,   reward: { gold: 50 } },
  { id: 'c11', title: 'Нанять 5 менеджеров',          kind: 'managers',    goal: 5,    reward: { gold: 60 } },
  { id: 'c12', title: 'Открыть 9 отделов',            kind: 'floorsOpen',  goal: 9,    reward: { gold: 70 } },
  { id: 'c13', title: 'Лифт до 100 ур.',              kind: 'elevLvl',     goal: 100,  reward: { gold: 80 } },
  { id: 'c14', title: 'Отдел до 100 уровня',          kind: 'anyFloorLvl', goal: 100,  reward: { gold: 90 } },
  { id: 'c15', title: 'Открыть 12 отделов',           kind: 'floorsOpen',  goal: 12,   reward: { gold: 110 } },
  { id: 'c16', title: 'Нанять 10 менеджеров',         kind: 'managers',    goal: 10,   reward: { gold: 130 } },
  { id: 'c17', title: 'Открыть все 15 отделов',       kind: 'floorsOpen',  goal: 15,   reward: { gold: 160 } },
  { id: 'c18', title: 'Хранилище до 200 ур.',         kind: 'vaultLvl',    goal: 200,  reward: { gold: 200 } },
  { id: 'c19', title: 'Все отделы с менеджерами',     kind: 'managers',    goal: 17,   reward: { gold: 260 } },
  { id: 'c20', title: 'Отдел до 250 уровня',          kind: 'anyFloorLvl', goal: 250,  reward: { gold: 320 } },
];

// ─────────────────────────────────────────────────────────────────────────────
// РЕНОВАЦИЯ (престиж)
// ─────────────────────────────────────────────────────────────────────────────

export const PRESTIGE = {
  minEarned: 1e10,           // минимум заработано за забег, чтобы реновация открылась
  divisor: 1e10,             // делитель в формуле акций
  exp: 0.4,                  // показатель степени
  mult: 10,
  bonusPerShare: 0.02,       // +2 % к доходу за акцию
  icon: '📜',
};

export function sharesFor(earned, scale = 1) {
  const e = earned / (PRESTIGE.divisor * Math.max(1, scale));
  if (e <= 1) return 0;
  return Math.floor(PRESTIGE.mult * e ** PRESTIGE.exp);
}

// Дерево совета директоров — постоянные апгрейды за акции.
export const BOARD_UPGRADES = [
  { id: 'b_income', title: 'Доходность',      desc: '+8 % к доходу банка за уровень',      max: 50, cost: 3,  grow: 1.35, v: 0.08,  kind: 'allIncome' },
  { id: 'b_speed',  title: 'Темп работы',     desc: '+5 % к скорости клерков за уровень',  max: 40, cost: 4,  grow: 1.38, v: 0.05,  kind: 'floorSpeed' },
  { id: 'b_elev',   title: 'Скоростной лифт', desc: '+7 % к пропускной способности лифта', max: 40, cost: 4,  grow: 1.38, v: 0.07,  kind: 'elevAll' },
  { id: 'b_vault',  title: 'Автоматизация кассы', desc: '+7 % к скорости хранилища',       max: 40, cost: 4,  grow: 1.38, v: 0.07,  kind: 'vaultAll' },
  { id: 'b_cost',   title: 'Оптимизация затрат', desc: '−2 % к цене улучшений',            max: 25, cost: 6,  grow: 1.45, v: 0.02,  kind: 'costCut' },
  { id: 'b_offline',title: 'Ночная смена',    desc: '+10 % к оффлайн-доходу',              max: 30, cost: 5,  grow: 1.40, v: 0.10,  kind: 'offline' },
  { id: 'b_tap',    title: 'VIP-обслуживание',desc: '+25 % к ручному обслуживанию',        max: 30, cost: 4,  grow: 1.38, v: 0.25,  kind: 'tapValue' },
  { id: 'b_start',  title: 'Стартовый капитал',desc: 'После реновации сразу доступно больше отделов', max: 14, cost: 8, grow: 1.5, v: 1, kind: 'startFloors' },
];

// ─────────────────────────────────────────────────────────────────────────────
// МАГАЗИН
// ─────────────────────────────────────────────────────────────────────────────

export const SHOP_GOLD = [
  { id: 'g1', gold: 50,    stars: 25,   art: 'lu_box',  tag: '' },
  { id: 'g2', gold: 300,   stars: 130,  art: 'lu_box',  tag: '+10 %' },
  { id: 'g3', gold: 800,   stars: 320,  art: 'lu_hex',  tag: '+25 %' },
  { id: 'g4', gold: 2000,  stars: 700,  art: 'lu_hex',  tag: '+40 %', best: true },
  { id: 'g5', gold: 5500,  stars: 1700, art: 'box_fortune', tag: '+60 %' },
  { id: 'g6', gold: 15000, stars: 4000, art: 'box_lucky',   tag: '+85 %' },
];

export const SHOP_OFFERS = [
  { id: 'o_start', title: 'Стартовый пакет', desc: '400 золота, серебряный сейф и буст ×2 на 4 часа', stars: 150, once: true,
    give: { gold: 400, chest: 'silver', boost: 'income2x' } },
  { id: 'o_cash',  title: 'Инъекция капитала', desc: 'Мгновенно 8 часов дохода', stars: 90,
    give: { cashHours: 8 } },
  { id: 'o_mgr',   title: 'Набор кадров', desc: '3 сейфа подряд: шанс на легендарную карту', stars: 260,
    give: { chest: 'gold', chestCount: 3 } },
];

// ─────────────────────────────────────────────────────────────────────────────
// ТУТОРИАЛ
// ─────────────────────────────────────────────────────────────────────────────

export const TUTORIAL = [
  { id: 't1', text: 'Это ваш банк. Нажмите на стойку отдела, чтобы обслужить клиентов вручную.', target: 'floor0' },
  { id: 't2', text: 'Деньги копятся у стойки. Нажмите на лифт, чтобы отвезти их вниз.', target: 'elevator' },
  { id: 't3', text: 'Хранилище превращает наличные в ваш капитал. Нажмите на него.', target: 'vault' },
  { id: 't4', text: 'Улучшайте отдел — клерк будет носить больше денег.', target: 'upgrade0' },
  { id: 't5', text: 'Менеджер работает за вас без нажатий. Наймите его, когда хватит денег.', target: 'manager0' },
  { id: 't6', text: 'Открывайте новые отделы — они приносят кратно больше.', target: 'unlock1' },
];

export const UPGRADE_STEPS = [1, 10, 100, 'max'];

export const SAVE_KEY = 'idlebank_save_v1';
export const TICK_MS = 50;             // шаг симуляции
export const SAVE_EVERY_MS = 5000;
