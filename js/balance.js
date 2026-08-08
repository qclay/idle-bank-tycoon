// Все балансные числа. В остальном коде констант быть не должно.

// ─── Планировка зала пункта выдачи ───────────────────────────────────────────
// Тайловая сетка. Стойка занимает 2×1: (x, y) и (x+1, y).
// Оператор стоит за стойкой (y-1), клиент подходит спереди (y+1).

export const HALL = { w: 24, h: 15 };

export const VAULT = { x: 1, y: 1, w: 2.6, h: 1.6, drop: { x: 2.3, y: 3.5 } };

// Улица снаружи: тротуар, дорога, дальний тротуар с фасадами
export const STREET = { walk: 2.4, road: 3.6, far: 2.2 };
export const DOOR = { x: 21.5, y: 14.4 };          // вход: отсюда приходят клиенты
export const START = { x: 12, y: 11 };             // где игрок стоит на старте

// Стойки выдачи: cost — цена открытия, base — выручка с одного клиента на 1 ур.
export const COUNTERS = [
  { id: 'c1', name: 'Выдача заказов', x: 6,  y: 2, cost: 0,      base: 12,    tone: 0x7C3AED },
  { id: 'c2', name: 'Примерочная',    x: 11, y: 2, cost: 900,    base: 46,    tone: 0x0EA5E9 },
  { id: 'c3', name: 'Приём возвратов',x: 16, y: 2, cost: 9000,   base: 190,   tone: 0x22C55E },
  { id: 'c4', name: 'Крупногабарит',  x: 6,  y: 8, cost: 78000,  base: 760,   tone: 0xF59E0B },
  { id: 'c5', name: 'Экспресс-выдача',x: 11, y: 8, cost: 640000, base: 3000,  tone: 0xEC4899 },
  { id: 'c6', name: 'Premium-зона',   x: 16, y: 8, cost: 5.2e6,  base: 12000, tone: 0x14B8A6 },
];

// Постаматы: выдают заказы сами, выручка копится в ячейках — её тоже нужно забирать
export const ATMS = [
  { id: 'a1', name: 'Постамат', x: 1.7, y: 5.4,  cost: 4200,   rate: 26,   tone: 0x8B5CF6 },
  { id: 'a2', name: 'Постамат', x: 1.7, y: 7.8,  cost: 130000, rate: 520,  tone: 0x8B5CF6 },
  { id: 'a3', name: 'Постамат', x: 1.7, y: 10.2, cost: 2.4e6,  rate: 7800, tone: 0x8B5CF6 },
  { id: 'a4', name: 'Постамат', x: 1.7, y: 12.6, cost: 4.1e7,  rate: 1.1e5,tone: 0x8B5CF6 },
];

// Зоны пункта: разовая постройка с постоянным эффектом на весь бизнес.
// Ставятся на площадку в зале, уровни качаются в окне «Бизнес».
export const ZONES = [
  { id: 'z_coffee', name: 'Кофе-точка',  x: 20.6, y: 2.2,  cost: 26000,  ic: 'i-cup',
    tone: 0xF59E0B, effect: 'spawn',   step: 0.10, grow: 1.6, max: 20,
    desc: 'Клиенты приходят чаще' },
  { id: 'z_fit',    name: 'Примерочные', x: 20.6, y: 5.6,  cost: 210000, ic: 'i-fit',
    tone: 0xEC4899, effect: 'pay',     step: 0.12, grow: 1.65, max: 20,
    desc: 'Клиенты платят больше' },
  { id: 'z_sort',   name: 'Сортировка',  x: 20.6, y: 9.0,  cost: 1.6e6,  ic: 'i-sort',
    tone: 0x0EA5E9, effect: 'speed',   step: 0.12, grow: 1.7, max: 20,
    desc: 'Операторы работают быстрее' },
  { id: 'z_load',   name: 'Погрузка',    x: 20.6, y: 12.4, cost: 1.2e7,  ic: 'i-truck',
    tone: 0x22C55E, effect: 'offline',  step: 0.15, grow: 1.7, max: 20,
    desc: 'Больше дохода, пока вас нет' },
];

// ─── Прокачка ────────────────────────────────────────────────────────────────

export const UPGRADES = {
  // Пад стоит в зале, игрок встаёт на него и держит — деньги списываются
  bag:   { id: 'bag',   name: 'Тележка',  desc: 'Больше выручки за раз', x: 6.0,  y: 12.6,
           cost: 260,  grow: 1.55, step: 6,    base: 12,  max: 60, ic: 'i-cart' },
  boots: { id: 'boots', name: 'Кроссовки',desc: 'Скорость ходьбы',       x: 9.6,  y: 12.6,
           cost: 420,  grow: 1.62, step: 0.26, base: 4.3, max: 30, ic: 'i-run' },
  vault: { id: 'vault', name: 'Касса',    desc: 'Множитель выручки',     x: 13.2, y: 12.6,
           cost: 1500, grow: 1.7,  step: 0.12, base: 1,   max: 40, ic: 'i-coin' },
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
    id: 'clerk', name: 'Оператор', desc: 'Сам выдаёт заказы на стойке',
    art: './assets/char/se_0.png',
    cost: 3500, grow: 3.4, speedBase: 1, speedStep: 0.18, maxLvl: 20,
  },
  runner: {
    id: 'runner', name: 'Администратор', desc: 'Сам относит выручку в кассу',
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
  money2x: { id: 'money2x', name: 'Выручка ×2', desc: 'Клиенты платят вдвое больше',
             mult: 2, dur: 2 * 3600, gold: 25, freeCd: 25 * 60, ic: 'i-coin', tone: 'gold' },
  rush:    { id: 'rush',    name: 'Наплыв',     desc: 'Заказов приходит втрое больше',
             mult: 3, dur: 600,      gold: 20, freeCd: 20 * 60, ic: 'i-staff', tone: 'cyan' },
  sprint:  { id: 'sprint',  name: 'Спринт',     desc: 'Скорость и тележка ×2 на 5 минут',
             mult: 2, dur: 300,      gold: 15, freeCd: 15 * 60, ic: 'i-bolt', tone: '' },
};

// ─── Сейфы ───────────────────────────────────────────────────────────────────

// Награды приходят «посылками»: обычная, ценная и VIP
export const SAFES = {
  free:   { id: 'free',   name: 'Посылка',     gold: 0,   cd: 3 * 3600, ic: 'i-box',  tone: '',
            cashMin: 0.3, cashMax: 1.2, goldMin: 3,  goldMax: 12 },
  silver: { id: 'silver', name: 'Ценная',      gold: 60,  cd: 0, ic: 'i-gift', tone: 'cyan',
            cashMin: 1.5, cashMax: 4,   goldMin: 12, goldMax: 34 },
  gold:   { id: 'gold',   name: 'VIP-посылка', gold: 240, cd: 0, ic: 'i-gift', tone: 'gold',
            cashMin: 5,   cashMax: 13,  goldMin: 45, goldMax: 120 },
};

// ─── Задания ─────────────────────────────────────────────────────────────────

export const DAILY_POOL = [
  { id: 'd_serve',  stat: 'served',   goal: 40,  title: 'Выдать 40 заказов',       gold: 14 },
  { id: 'd_serve2', stat: 'served',   goal: 120, title: 'Выдать 120 заказов',      gold: 30 },
  { id: 'd_dep',    stat: 'deposits', goal: 25,  title: '25 раз сдать выручку',    gold: 12 },
  { id: 'd_up',     stat: 'upgrades', goal: 8,   title: '8 улучшений',             gold: 18 },
  { id: 'd_open',   stat: 'opened',   goal: 1,   title: 'Открыть новую зону',      gold: 25 },
  { id: 'd_boost',  stat: 'boosts',   goal: 2,   title: 'Запустить 2 буста',       gold: 15 },
  { id: 'd_safe',   stat: 'safes',    goal: 1,   title: 'Открыть посылку',         gold: 12 },
  { id: 'd_hire',   stat: 'hires',    goal: 1,   title: 'Нанять сотрудника',       gold: 22 },
];
export const DAILY_COUNT = 3;
export const DAILY_ALL = { gold: 45 };

export const ACHIEVEMENTS = [
  { id: 'a_serve', stat: 'served',   title: 'Выдача заказов', tiers: [50, 500, 3000, 15000, 80000],  gold: [10, 25, 55, 120, 260] },
  { id: 'a_earn',  stat: 'earned',   title: 'Оборот',       tiers: [5e3, 2e5, 1e7, 5e8, 2e10],     gold: [10, 25, 55, 120, 260], money: true },
  { id: 'a_open',  stat: 'opened',   title: 'Расширение',   tiers: [1, 3, 5, 8, 11],               gold: [15, 35, 70, 150, 320] },
  { id: 'a_hire',  stat: 'hires',    title: 'Команда',         tiers: [1, 3, 6, 10, 16],              gold: [15, 35, 70, 150, 320] },
  { id: 'a_up',    stat: 'upgrades', title: 'Модернизация', tiers: [10, 60, 200, 600, 1500],       gold: [10, 25, 55, 120, 260] },
  { id: 'a_dep',   stat: 'deposits', title: 'Кассовая дисциплина',   tiers: [30, 300, 2000, 10000, 50000],  gold: [10, 25, 55, 120, 260] },
];

// ─── Магазин ─────────────────────────────────────────────────────────────────

export const SHOP_GOLD = [
  { id: 'g1', gold: 50,    stars: 25,   size: .62 },
  { id: 'g2', gold: 300,   stars: 130,  size: .74, tag: '+10%' },
  { id: 'g3', gold: 800,   stars: 320,  size: .84, tag: '+25%' },
  { id: 'g4', gold: 2000,  stars: 700,  size: .92, tag: '+40%' },
  { id: 'g5', gold: 5500,  stars: 1700, size: 1,   tag: '+60%' },
  { id: 'g6', gold: 15000, stars: 4000, size: 1,   tag: '+85%', best: true },
];

// Оплата на площадке идёт, только когда игрок ОСТАНОВИЛСЯ на ней.
// Пауза от одного скорости мало: зона больше двух тайлов, и на проходе
// игрок успевал её выстоять — деньги списывались по дороге к кассе.
export const PAD_DWELL = 0.22;      // секунд после остановки
export const PAD_STOP_SPEED = 0.9;  // тайлов/с: быстрее — считаем, что идёт мимо

// ─── Гонка за район ──────────────────────────────────────────────────────────
// Соперник берёт темп от игрока: чем активнее играешь, тем увереннее ведёшь.
// С каждой победой он становится злее, после поражения — слабее.
export const DISTRICT = {
  name: 'СкороПункт',        // вывеска конкурента через дорогу
  baseFactor: 0.86,          // доля от вашего темпа на 1-м уровне злости
  factorPerLvl: 0.07,
  minRate: 0.012,            // заказов/с, даже если вы совсем не играете
  paceTau: 120,              // сек сглаживания текущего темпа
  paceHalfLifeH: 6,          // за столько часов «память» о вашем темпе слабеет вдвое
  offlineRate: 0.35,         // вполсилы, пока вас нет
  offlineCapH: 12,
  winGold: 60,
  streakGold: 15,
  loseGold: 15,
};

export const SAVE_KEY = 'idlebank2';
export const SAVE_EVERY = 5000;
