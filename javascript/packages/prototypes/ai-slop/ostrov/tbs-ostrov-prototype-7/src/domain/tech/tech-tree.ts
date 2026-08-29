import type { TBranch, TEffect, TTech } from "./types";

/**
 * Compact authoring shape: one trunk step with its two twigs.
 * The first twig hangs forward, the second hangs backward.
 */
type TTwigDraft = {
  id: string;
  name: string;
  icon: string;
  description: string;
  effects: TEffect[];
};

type TTrunkDraft = TTwigDraft & {
  twigs: [TTwigDraft, TTwigDraft];
};

const unlockBuilding = (target: string): TEffect => ({ kind: "unlockBuilding", target });
const unlockUnit = (target: string): TEffect => ({ kind: "unlockUnit", target });
const improveBuilding = (target: string, note: string): TEffect => ({ kind: "improveBuilding", target, note });
const improveUnit = (target: string, note: string): TEffect => ({ kind: "improveUnit", target, note });

const ROOT: TTech = {
  id: "government",
  name: "Правительство",
  icon: "🏛️",
  description: "Первые законы и вождь. Племя становится поселением, которое может ставить лагерь.",
  branch: "root",
  tier: 0,
  slot: "trunk",
  requires: [],
  effects: [unlockBuilding("Лагерь")],
};

const ARMY_TRUNK: TTrunkDraft[] = [
  {
    id: "militia", name: "Ополчение", icon: "🪖",
    description: "Каждый взрослый берёт оружие. Появляется первый боевой отряд.",
    effects: [unlockUnit("Ополченец")],
    twigs: [
      { id: "spears", name: "Копья", icon: "🔱", description: "Длинные копья держат врага на расстоянии и бьют сильнее.", effects: [improveUnit("Ополченец", "+2 к атаке")] },
      { id: "palisade", name: "Частокол", icon: "🪵", description: "Заострённые брёвна вокруг поселения защищают от набегов.", effects: [unlockBuilding("Частокол")] },
    ],
  },
  {
    id: "barracks", name: "Казармы", icon: "⛺",
    description: "Постоянное место для обучения и содержания воинов.",
    effects: [unlockBuilding("Казармы")],
    twigs: [
      { id: "archery", name: "Стрельба из лука", icon: "🏹", description: "Лук и стрелы позволяют поражать врага издалека.", effects: [unlockUnit("Лучник")] },
      { id: "leather-armor", name: "Кожаные доспехи", icon: "🥋", description: "Дублёная кожа смягчает удары и спасает жизни ополченцев.", effects: [improveUnit("Ополченец", "+2 к защите")] },
    ],
  },
  {
    id: "horse-riding", name: "Верховая езда", icon: "🐎",
    description: "Прирученные лошади дают быстрые конные отряды.",
    effects: [unlockUnit("Всадник")],
    twigs: [
      { id: "stirrups", name: "Стремена", icon: "🥾", description: "Опора для ног делает всадника устойчивым и быстрым.", effects: [improveUnit("Всадник", "+1 к скорости")] },
      { id: "watchtower", name: "Сторожевая башня", icon: "🗼", description: "Высокая башня замечает врага задолго до подхода.", effects: [unlockBuilding("Башня")] },
    ],
  },
  {
    id: "siegecraft", name: "Осадное дело", icon: "🪨",
    description: "Метательные машины ломают стены и башни противника.",
    effects: [unlockUnit("Катапульта")],
    twigs: [
      { id: "forge", name: "Кузница", icon: "⚒️", description: "Горн и наковальня дают сталь для лучшего оружия.", effects: [unlockBuilding("Кузница"), improveUnit("Лучник", "стальные наконечники")] },
      { id: "stone-walls", name: "Каменные стены", icon: "🧱", description: "Каменная кладка заменяет дерево и держит осаду.", effects: [improveBuilding("Частокол", "камень вместо дерева")] },
    ],
  },
  {
    id: "war-academy", name: "Военная академия", icon: "🎖️",
    description: "Школа командиров поднимает мастерство всей армии.",
    effects: [
      unlockBuilding("Академия"),
      improveUnit("Ополченец", "+1 к уровню"),
      improveUnit("Лучник", "+1 к уровню"),
      improveUnit("Всадник", "+1 к уровню"),
    ],
    twigs: [
      { id: "tactics", name: "Тактика", icon: "♟️", description: "Построения и манёвры ускоряют подготовку войск.", effects: [improveBuilding("Казармы", "обучение в два раза быстрее")] },
      { id: "trebuchet", name: "Требушет", icon: "🏗️", description: "Противовес бросает камни дальше любой катапульты.", effects: [improveUnit("Катапульта", "+3 к дальности")] },
    ],
  },
];

const ECONOMY_TRUNK: TTrunkDraft[] = [
  {
    id: "farming", name: "Земледелие", icon: "🌾",
    description: "Посевы дают надёжную еду и первые фермы.",
    effects: [unlockBuilding("Ферма")],
    twigs: [
      { id: "plough", name: "Плуг", icon: "🐂", description: "Плуг вспахивает больше земли и повышает урожай.", effects: [improveBuilding("Ферма", "+1 к еде")] },
      { id: "fishing", name: "Рыбалка", icon: "🎣", description: "Сети и лодки открывают богатство моря.", effects: [unlockBuilding("Причал")] },
    ],
  },
  {
    id: "crafts", name: "Ремесло", icon: "🧵",
    description: "Умелые руки создают инструменты и товары в мастерской.",
    effects: [unlockBuilding("Мастерская")],
    twigs: [
      { id: "pottery", name: "Гончарное дело", icon: "🏺", description: "Глиняные сосуды хранят припасы дольше.", effects: [improveBuilding("Лагерь", "склад припасов")] },
      { id: "weaving", name: "Ткачество", icon: "🧶", description: "Ткацкий станок ускоряет работу мастерской.", effects: [improveBuilding("Мастерская", "+1 к производству")] },
    ],
  },
  {
    id: "trade", name: "Торговля", icon: "⚖️",
    description: "Обмен товарами с соседями приносит золото и рынок.",
    effects: [unlockBuilding("Рынок"), unlockUnit("Торговец")],
    twigs: [
      { id: "caravans", name: "Караваны", icon: "🐪", description: "Вьючные животные перевозят больше товаров.", effects: [improveUnit("Торговец", "+2 к вместимости")] },
      { id: "coinage", name: "Чеканка монет", icon: "🪙", description: "Единая монета упрощает сделки и наполняет рынок.", effects: [improveBuilding("Рынок", "+2 к золоту")] },
    ],
  },
  {
    id: "mining", name: "Горное дело", icon: "⛏️",
    description: "Шахты добывают руду и камень из глубины.",
    effects: [unlockBuilding("Шахта")],
    twigs: [
      { id: "pickaxe", name: "Кирка", icon: "💎", description: "Крепкая кирка ускоряет добычу в шахтах.", effects: [improveBuilding("Шахта", "+2 к добыче")] },
      { id: "quarry", name: "Каменоломня", icon: "🗿", description: "Каменоломня даёт камень для стен и дорог.", effects: [unlockBuilding("Каменоломня")] },
    ],
  },
  {
    id: "banking", name: "Банковское дело", icon: "🏦",
    description: "Хранение и ссуды золота создают банк.",
    effects: [unlockBuilding("Банк"), improveBuilding("Рынок", "+1 к уровню")],
    twigs: [
      { id: "guilds", name: "Гильдии", icon: "🤝", description: "Объединения мастеров поднимают уровень ремесла.", effects: [improveBuilding("Мастерская", "+1 к уровню")] },
      { id: "harbor", name: "Гавань", icon: "⚓", description: "Глубокая гавань принимает торговые суда.", effects: [improveBuilding("Причал", "торговые суда")] },
    ],
  },
];

const SCIENCE_TRUNK: TTrunkDraft[] = [
  {
    id: "writing", name: "Письменность", icon: "📜",
    description: "Знаки на глине сохраняют знания в библиотеке.",
    effects: [unlockBuilding("Библиотека")],
    twigs: [
      { id: "scrolls", name: "Свитки", icon: "📚", description: "Свитки удобнее табличек и ускоряют науку.", effects: [improveBuilding("Библиотека", "+1 к науке")] },
      { id: "counting", name: "Счёт", icon: "🧮", description: "Учёт запасов наводит порядок в лагере.", effects: [improveBuilding("Лагерь", "учёт запасов")] },
    ],
  },
  {
    id: "philosophy", name: "Философия", icon: "🧠",
    description: "Размышления о мире рождают первых учёных.",
    effects: [unlockUnit("Учёный")],
    twigs: [
      { id: "logic", name: "Логика", icon: "🔗", description: "Строгие рассуждения делают учёных продуктивнее.", effects: [improveUnit("Учёный", "+1 к науке")] },
      { id: "school", name: "Школа", icon: "🏫", description: "Дети учатся читать и считать в школе.", effects: [unlockBuilding("Школа")] },
    ],
  },
  {
    id: "mathematics", name: "Математика", icon: "📐",
    description: "Числа и доказательства поднимают библиотеку и школу.",
    effects: [improveBuilding("Библиотека", "+1 к уровню"), improveBuilding("Школа", "+1 к уровню")],
    twigs: [
      { id: "geometry", name: "Геометрия", icon: "📏", description: "Точные чертежи улучшают работу мастерской.", effects: [improveBuilding("Мастерская", "точные чертежи")] },
      { id: "astronomy", name: "Астрономия", icon: "🔭", description: "Наблюдение звёзд требует обсерватории.", effects: [unlockBuilding("Обсерватория")] },
    ],
  },
  {
    id: "university", name: "Университет", icon: "🎓",
    description: "Собрание учёных и студентов под одной крышей.",
    effects: [unlockBuilding("Университет")],
    twigs: [
      { id: "printing", name: "Печать", icon: "🖨️", description: "Печатный станок распространяет знания быстрее.", effects: [improveBuilding("Университет", "+2 к науке")] },
      { id: "alchemy", name: "Алхимия", icon: "⚗️", description: "Опыты с веществами делают учёных опытнее.", effects: [improveUnit("Учёный", "+1 к уровню")] },
    ],
  },
  {
    id: "scientific-method", name: "Научный метод", icon: "🔬",
    description: "Гипотеза и проверка поднимают все учебные заведения.",
    effects: [
      improveBuilding("Библиотека", "+1 к уровню"),
      improveBuilding("Школа", "+1 к уровню"),
      improveBuilding("Университет", "+1 к уровню"),
    ],
    twigs: [
      { id: "optics", name: "Оптика", icon: "👓", description: "Линзы и телескоп усиливают обсерваторию.", effects: [improveBuilding("Обсерватория", "телескоп")] },
      { id: "encyclopedia", name: "Энциклопедия", icon: "📖", description: "Собрание всех знаний резко ускоряет учёных.", effects: [improveUnit("Учёный", "+2 к науке")] },
    ],
  },
];

const flattenTrunk = (branch: TBranch, trunk: TTrunkDraft[]): TTech[] => {
  const techs: TTech[] = [];
  let previousId = ROOT.id;

  trunk.forEach((step, index) => {
    const tier = index + 1;

    techs.push({
      id: step.id,
      name: step.name,
      branch,
      tier,
      slot: "trunk",
      requires: [previousId],
      icon: step.icon,
      description: step.description,
      effects: step.effects,
    });

    step.twigs.forEach((twig) => {
      techs.push({
        id: twig.id,
        name: twig.name,
        branch,
        tier,
        slot: "twig",
        requires: [step.id],
        icon: twig.icon,
        description: twig.description,
        effects: twig.effects,
      });
    });

    previousId = step.id;
  });

  return techs;
};

const TECHS: TTech[] = [
  ROOT,
  ...flattenTrunk("army", ARMY_TRUNK),
  ...flattenTrunk("economy", ECONOMY_TRUNK),
  ...flattenTrunk("science", SCIENCE_TRUNK),
];

const TECH_BY_ID = new Map(TECHS.map((tech) => [tech.id, tech]));

const techOf = (id: string): TTech => {
  const tech = TECH_BY_ID.get(id);
  if (!tech) {
    throw new Error(`Unknown tech: ${id}`);
  }

  return tech;
};

/** Twigs are listed right after their trunk node, so trunk order is stable. */
const trunkOf = (branch: TBranch): TTech[] => TECHS.filter((tech) => tech.branch === branch && tech.slot === "trunk");

const twigsOf = (trunkId: string): TTech[] => TECHS.filter((tech) => tech.slot === "twig" && tech.requires[0] === trunkId);

const BRANCH_LABEL: Record<TBranch, string> = {
  root: "Основание",
  army: "Сильнее армия",
  economy: "Больше ресурсов",
  science: "Быстрее наука",
};

export { BRANCH_LABEL, ROOT, TECHS, techOf, trunkOf, twigsOf };
