// Все балансные числа. В остальном коде констант быть не должно.

// ─── Планировка зала ─────────────────────────────────────────────────────────
// Тайловая сетка. Стойка занимает 2×1: (x, y) и (x+1, y).
// Клерк стоит за стойкой (y-1), клиент подходит спереди (y+1).

export const HALL = { w: 18, h: 13 };

export const VAULT = { x: 1, y: 1, w: 2.6, h: 1.6, drop: { x: 2.3, y: 3.5 } };
export const DOOR = { x: 16, y: 12.3 };            // вход: отсюда приходят клиенты
export const START = { x: 10, y: 9 };              // где игрок стоит на старте

// Стойки: cost — цена открытия, base — доход с одного клиента на 1-м уровне
export const COUNTERS = [
  { id: 'c1', name: 'Приём вкладов',   x: 6,  y: 2, cost: 0,      base: 12,   tone: 0x4f86c6 },
  { id: 'c2', name: 'Обмен валют',     x: 10, y: 2, cost: 900,    base: 46,   tone: 0xd8a13a },
  { id: 'c3', name: 'Кредиты',         x: 14, y: 2, cost: 9000,   base: 190,  tone: 0x5aa95e },
  { id: 'c4', name: 'Ипотека',         x: 6,  y: 7, cost: 78000,  base: 760,  tone: 0x9b6bd0 },
  { id: 'c5', name: 'Инвестиции',      x: 10, y: 7, cost: 640000, base: 3000, tone: 0x2fa6a0 },
  { id: 'c6', name: 'Private Banking', x: 14, y: 7, cost: 5.2e6,  base: 12000, tone: 0xd06a6a },
];

// Банкоматы: пассивный доход, наличные копятся в лотке, их тоже нужно забирать
export const ATMS = [
  { id: 'a1', name: 'Банкомат',    x: 1,  y: 6.4, cost: 4200,   rate: 26,   tone: 0x6d7f97 },
  { id: 'a2', name: 'Банкомат',    x: 1,  y: 8.2, cost: 130000, rate: 520,  tone: 0x6d7f97 },
];

// ─── Прокачка ────────────────────────────────────────────────────────────────

export const UPGRADES = {
  // Пад стоит в зале, игрок встаёт на него и держит — деньги списываются
  bag:   { id: 'bag',   name: 'Сумка',    desc: 'Больше наличных за раз', x: 1,  y: 4.3,
           cost: 260,  grow: 1.55, step: 6,   base: 12,  max: 60, icon: './assets/barn/cargo.png' },
  boots: { id: 'boots', name: 'Ботинки',  desc: 'Скорость ходьбы',        x: 3.4, y: 4.3,
           cost: 420,  grow: 1.62, step: 0.26, base: 4.3, max: 30, icon: './assets/ui/energy.png' },
  vault: { id: 'vault', name: 'Хранилище',desc: 'Множитель дохода',       x: 4.4, y: 1.3,
           cost: 1500, grow: 1.7,  step: 0.12, base: 1,   max: 40, icon: './assets/ui/hud_coin.png' },
};

// Уровень стойки: цена и прибавка
export const COUNTER_UP = { costRatio: 0.55, grow: 1.16, payGrow: 1.14, speedGrow: 1.02 };

// ─── Клиенты ─────────────────────────────────────────────────────────────────

export const CUSTOMER = {
  spawnBase: 2.1,        // секунд между клиентами при одной стойке
  spawnPerCounter: 0.62, // во столько раз чаще с каждой открытой стойкой
  minSpawn: 0.45,
  serveTime: 1.35,       // сколько секунд обслуживается один клиент
  patience: 46,          // через сколько секунд без обслуживания уходит
  maxQueue: 3,           // очередь к одной стойке
  speed: 2.4,
  walkOff: 2.3,
};

// ─── Персонал ────────────────────────────────────────────────────────────────

export const STAFF = {
  clerk: {
    id: 'clerk', name: 'Кассир', desc: 'Сам обслуживает клиентов за стойкой',
    art: './assets/char/se_0.png',
    cost: 3500, grow: 3.4, speedBase: 1, speedStep: 0.18, maxLvl: 20,
  },
  runner: {
    id: 'runner', name: 'Инкассатор', desc: 'Сам относит наличные в хранилище',
    art: './assets/char/nw_0.png',
    cost: 12000, grow: 3.6, bagBase: 30, bagStep: 14, speedBase: 2.6, speedStep: 0.14, maxLvl: 20,
  },
};

// ─── Уровень игрока ──────────────────────────────────────────────────────────

export const XP = { perServe: 2, perDeposit: 1, perBuy: 40, perUpgrade: 12, perTask: 30,
                    base: 90, grow: 1.26, goldPerLevel: 6 };
export function xpForLevel(l) { return Math.floor(XP.base * XP.grow ** (l - 1)); }

// ─── Оффлайн ─────────────────────────────────────────────────────────────────

export const OFFLINE = { capHours: 3, maxCapHours: 24, upHours: 3,
                         upGoldBase: 50, upGoldGrow: 1.6, rate: 0.55, doubleGold: 30 };

// ─── Бусты ───────────────────────────────────────────────────────────────────

export const BOOSTS = {
  money2x: { id: 'money2x', name: 'Доход ×2', desc: 'Клиенты платят вдвое больше',
             mult: 2, dur: 2 * 3600, gold: 25, freeCd: 25 * 60, art: './assets/ui/hud_coin.png' },
  rush:    { id: 'rush',    name: 'Наплыв',   desc: 'Клиенты идут втрое чаще',
             mult: 3, dur: 600,      gold: 20, freeCd: 20 * 60, art: './assets/ui/hud_people.png' },
  sprint:  { id: 'sprint',  name: 'Спринт',   desc: 'Скорость и сумка ×2 на 5 минут',
             mult: 2, dur: 300,      gold: 15, freeCd: 15 * 60, art: './assets/ui/energy_big.png' },
};

// ─── Сейфы ───────────────────────────────────────────────────────────────────

export const SAFES = {
  free:   { id: 'free',   name: 'Бесплатный', gold: 0,   cd: 3 * 3600, art: './assets/tasks/chest1.png',
            cashMin: 0.3, cashMax: 1.2, goldMin: 3,  goldMax: 12 },
  silver: { id: 'silver', name: 'Серебряный', gold: 60,  cd: 0, art: './assets/tasks/chest2.png',
            cashMin: 1.5, cashMax: 4,   goldMin: 12, goldMax: 34 },
  gold:   { id: 'gold',   name: 'Золотой',    gold: 240, cd: 0, art: './assets/tasks/chest3.png',
            cashMin: 5,   cashMax: 13,  goldMin: 45, goldMax: 120 },
};

// ─── Задания ─────────────────────────────────────────────────────────────────

export const DAILY_POOL = [
  { id: 'd_serve',  stat: 'served',   goal: 40,  title: 'Обслужить 40 клиентов',   gold: 14 },
  { id: 'd_serve2', stat: 'served',   goal: 120, title: 'Обслужить 120 клиентов',  gold: 30 },
  { id: 'd_dep',    stat: 'deposits', goal: 25,  title: '25 раз сдать выручку',    gold: 12 },
  { id: 'd_up',     stat: 'upgrades', goal: 8,   title: '8 улучшений',             gold: 18 },
  { id: 'd_open',   stat: 'opened',   goal: 1,   title: 'Открыть новый объект',    gold: 25 },
  { id: 'd_boost',  stat: 'boosts',   goal: 2,   title: 'Запустить 2 буста',       gold: 15 },
  { id: 'd_safe',   stat: 'safes',    goal: 1,   title: 'Открыть сейф',            gold: 12 },
  { id: 'd_hire',   stat: 'hires',    goal: 1,   title: 'Нанять сотрудника',       gold: 22 },
];
export const DAILY_COUNT = 3;
export const DAILY_ALL = { gold: 45 };

export const ACHIEVEMENTS = [
  { id: 'a_serve', stat: 'served',   title: 'Обслуживание', tiers: [50, 500, 3000, 15000, 80000],  gold: [10, 25, 55, 120, 260] },
  { id: 'a_earn',  stat: 'earned',   title: 'Оборот',       tiers: [5e3, 2e5, 1e7, 5e8, 2e10],     gold: [10, 25, 55, 120, 260], money: true },
  { id: 'a_open',  stat: 'opened',   title: 'Расширение',   tiers: [1, 3, 5, 8, 11],               gold: [15, 35, 70, 150, 320] },
  { id: 'a_hire',  stat: 'hires',    title: 'Штат',         tiers: [1, 3, 6, 10, 16],              gold: [15, 35, 70, 150, 320] },
  { id: 'a_up',    stat: 'upgrades', title: 'Модернизация', tiers: [10, 60, 200, 600, 1500],       gold: [10, 25, 55, 120, 260] },
  { id: 'a_dep',   stat: 'deposits', title: 'Инкассация',   tiers: [30, 300, 2000, 10000, 50000],  gold: [10, 25, 55, 120, 260] },
];

// ─── Магазин ─────────────────────────────────────────────────────────────────

export const SHOP_GOLD = [
  { id: 'g1', gold: 50,    stars: 25,   art: './assets/ui/lu_box.png' },
  { id: 'g2', gold: 300,   stars: 130,  art: './assets/ui/lu_box.png',      tag: '+10%' },
  { id: 'g3', gold: 800,   stars: 320,  art: './assets/ui/lu_hex.png',      tag: '+25%' },
  { id: 'g4', gold: 2000,  stars: 700,  art: './assets/ui/lu_hex.png',      tag: '+40%' },
  { id: 'g5', gold: 5500,  stars: 1700, art: './assets/ui/box_fortune.png', tag: '+60%' },
  { id: 'g6', gold: 15000, stars: 4000, art: './assets/ui/box_lucky.png',   tag: '+85%' },
];

export const SAVE_KEY = 'idlebank2';
export const SAVE_EVERY = 5000;
