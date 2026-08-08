// Все балансные числа. В остальном коде констант быть не должно.

// ─── Планировка зала пункта выдачи ───────────────────────────────────────────
// Тайловая сетка. Стойка занимает 2×1: (x, y) и (x+1, y).
// Оператор стоит за стойкой (y-1), клиент подходит спереди (y+1).

export const HALL = { w: 24, h: 15 };

export const VAULT = { x: 1, y: 1, w: 2.6, h: 1.6, drop: { x: 2.3, y: 3.5 } };

// Улица снаружи: тротуар, дорога, дальний тротуар с фасадами
export const STREET = { walk: 1.6, road: 2.6, far: 1.2, facade: 2.2 };
export const DOOR = { x: 21.5, y: 14.4 };          // вход: отсюда приходят клиенты
export const START = { x: 12, y: 11 };             // где игрок стоит на старте

// Стойки выдачи: cost — цена открытия, base — выручка с одного клиента на 1 ур.
export const COUNTERS = [
  { id: 'c1', name: 'Выдача заказов', x: 6,  y: 2, cost: 0,      base: 12,    tone: 0x7C3AED },
  { id: 'c2', name: 'Примерочная',    x: 11, y: 2, cost: 1200,   base: 44,    tone: 0x0EA5E9 },
  { id: 'c3', name: 'Приём возвратов',x: 16, y: 2, cost: 26000,  base: 165,   tone: 0x22C55E },
  { id: 'c4', name: 'Крупногабарит',  x: 6,  y: 8, cost: 620000, base: 640,   tone: 0xF59E0B },
  { id: 'c5', name: 'Экспресс-выдача',x: 11, y: 8, cost: 1.9e7,  base: 2600,  tone: 0xEC4899 },
  { id: 'c6', name: 'Premium-зона',   x: 16, y: 8, cost: 7.2e8,  base: 10500, tone: 0x14B8A6 },
];

// Постаматы: выдают заказы сами, выручка копится в ячейках — её тоже нужно забирать
export const ATMS = [
  { id: 'a1', name: 'Постамат', x: 1.7, y: 5.4,  cost: 9500,   rate: 14,    tone: 0x8B5CF6 },
  { id: 'a2', name: 'Постамат', x: 1.7, y: 7.8,  cost: 340000, rate: 240,   tone: 0x8B5CF6 },
  { id: 'a3', name: 'Постамат', x: 1.7, y: 10.2, cost: 1.4e7,  rate: 3400,  tone: 0x8B5CF6 },
  { id: 'a4', name: 'Постамат', x: 1.7, y: 12.6, cost: 6.5e8,  rate: 52000, tone: 0x8B5CF6 },
];

// Зоны пункта: разовая постройка с постоянным эффектом на весь бизнес.
// Ставятся на площадку в зале, уровни качаются в окне «Бизнес».
export const ZONES = [
  { id: 'z_coffee', name: 'Кофе-точка',  x: 20.6, y: 2.2,  cost: 120000,  ic: 'i-cup',
    tone: 0xF59E0B, effect: 'spawn',   step: 0.08, grow: 1.9, max: 20,
    desc: 'Клиенты приходят чаще' },
  { id: 'z_fit',    name: 'Примерочные', x: 20.6, y: 5.6,  cost: 4.2e6, ic: 'i-fit',
    tone: 0xEC4899, effect: 'pay',     step: 0.09, grow: 1.95, max: 20,
    desc: 'Клиенты платят больше' },
  { id: 'z_sort',   name: 'Сортировка',  x: 20.6, y: 9.0,  cost: 7.5e7,  ic: 'i-sort',
    tone: 0x0EA5E9, effect: 'speed',   step: 0.09, grow: 2.0, max: 20,
    desc: 'Операторы работают быстрее' },
  { id: 'z_load',   name: 'Погрузка',    x: 20.6, y: 12.4, cost: 9.5e8,  ic: 'i-truck',
    tone: 0x22C55E, effect: 'offline',  step: 0.12, grow: 2.0, max: 20,
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
export const COUNTER_UP = { costRatio: 0.8, grow: 1.23, payGrow: 1.125, speedGrow: 1.02 };

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
    cost: 5200, grow: 4.3, speedBase: 1, speedStep: 0.15, maxLvl: 20,
  },
  runner: {
    id: 'runner', name: 'Администратор', desc: 'Сам относит выручку в кассу',
    art: './assets/char/nw_0.png',
    cost: 26000, grow: 4.1, bagBase: 30, bagStep: 14, speedBase: 2.6, speedStep: 0.14, maxLvl: 20,
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
            cashMin: 0.25, cashMax: 0.8, goldMin: 3,  goldMax: 12 },
  silver: { id: 'silver', name: 'Ценная',      gold: 60,  cd: 0, ic: 'i-gift', tone: 'cyan',
            cashMin: 1,    cashMax: 2.5, goldMin: 12, goldMax: 34 },
  gold:   { id: 'gold',   name: 'VIP-посылка', gold: 240, cd: 0, ic: 'i-gift', tone: 'gold',
            cashMin: 3,    cashMax: 7,   goldMin: 45, goldMax: 120 },
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

// ─── Репутация, настроение клиентов и разборы ────────────────────────────────

export const REP = {
  start: 4.2, min: 1, max: 5,
  spawnPerStar: 0.16,        // поток клиентов за каждую звезду выше трёх
  payPerStar: 0.12,          // средний чек за звезду выше трёх
  upsetBase: 0.05,           // базовый шанс, что клиент останется недоволен
  upsetPerWait: 0.55,        // + за долю исчерпанного терпения в очереди
  upsetMoraleWeight: 0.35,   // + если у оператора просела мораль
  waitTimeout: 24,           // сколько секунд клиент ждёт разбора
  moodAt: 0.45,              // доля терпения, после которой клиент мрачнеет
  angryAt: 0.78,             // а после которой уже откровенно злится
  walkoutDelta: 0.11,        // ушёл, так и не дождавшись выдачи — бьёт больнее всего
  goodDelta: 0.018,          // отзыв в плюс
  badDelta: 0.075,           // ушёл неразобранным
  solvedDelta: 0.045,        // разобрались — репутация растёт
  fineDelta: -0.02,          // штраф гасит скандал, но осадок остаётся
  moraleMin: 0.45, moraleMax: 1.25,
  finePenalty: -0.22,        // мораль оператора после штрафа
  praiseBonus: 0.12,         // мораль, если оператор оказался прав
  moraleRecover: 0.004,      // в секунду мораль возвращается к единице
  fineShare: 0.5,            // штраф = столько минут выручки стойки
  bonusShare: 1.2,           // извинение с бонусом стоит дороже
  rightChance: 0.55,         // насколько часто оператор действительно прав
};

// Из чего складывается претензия. reason — что случилось, blame — чья вина чаще.
export const INCIDENTS = [
  { id: 'wait',   text: 'Долго ждал в очереди',        blame: 'staff' },
  { id: 'wrong',  text: 'Выдали не тот заказ',         blame: 'staff' },
  { id: 'damage', text: 'Коробка помята',              blame: 'both' },
  { id: 'rude',   text: 'Нагрубили на выдаче',         blame: 'staff' },
  { id: 'fit',    text: 'Не дали примерить',           blame: 'client' },
  { id: 'ret',    text: 'Отказали в возврате',         blame: 'client' },
  { id: 'lost',   text: 'Заказ не нашли на полке',     blame: 'staff' },
  { id: 'late',   text: 'Пришёл позже срока хранения', blame: 'client' },
];

export const REVIEW_NAMES = ['Азиза', 'Тимур', 'Мадина', 'Рустам', 'Камила', 'Джасур',
  'Нилуфар', 'Бекзод', 'Севара', 'Отабек', 'Дилноза', 'Санжар'];

export const REVIEW_GOOD = [
  'Забрал за минуту, всё чётко',
  'Вежливо и быстро, спасибо',
  'Очередь идёт живо, оператор молодец',
  'Удобный пункт, буду ходить сюда',
  'Помогли с примеркой, всё понравилось',
];
export const REVIEW_BAD = [
  'Стоял в очереди целую вечность',
  'Коробка мятая, настроение испорчено',
  'Выдали чужой заказ, пришлось ждать',
  'Никто не подошёл разобраться',
  'Больше сюда не приду',
];
// Ушёл, не дождавшись выдачи, — отдельная и самая злая пачка.
export const REVIEW_WALKOUT = [
  'Прождал и ушёл ни с чем — заказ так и не выдали',
  'Очередь не двигалась, бросил и уехал',
  'Пункт есть, а выдавать некому',
  'Потратил полчаса впустую, забирайте свой заказ сами',
  'Ушёл без посылки. Впечатление — хуже некуда',
];
export const REVIEW_SOLVED = [
  'Была накладка, но разобрались на месте',
  'Извинились и всё решили, приятно',
  'Проблему уладили быстро, спасибо',
];
export const REVIEW_MAX = 30;   // сколько отзывов храним в ленте

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

export const SAVE_EVERY = 5000;
