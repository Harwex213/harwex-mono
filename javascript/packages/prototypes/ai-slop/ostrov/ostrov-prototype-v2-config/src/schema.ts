import type {
  ConfigOf,
  ConfigValue,
  Field,
  Schema,
  ValidationIssue,
  ValidationResult,
} from "./types";

/**
 * Every tunable of the `ostrov-prototype-v2` island prototype.
 *
 * Declaration order is also the order of the editor UI and of the keys written
 * to `data/config.json`, so a save never reshuffles the file.
 *
 * This module is imported two ways: by the bundler (editor and game) and by
 * Node itself from `rspack.config.mjs`, which strips the types on the fly. That
 * is why it has no runtime imports — only `import type`, which Node erases.
 */

const TERRAIN_OPTIONS = [
  { value: "none", label: "Нет" },
  { value: "snow", label: "Снег" },
  { value: "grass", label: "Луг" },
  { value: "ice", label: "Лёд" },
  { value: "forest", label: "Лес" },
  { value: "sand", label: "Пустошь" },
] as const;

const SCHEMA = {
  hex: {
    label: "Гексы",
    description: "Размер и наклон одной клетки. Меняет всю геометрию карты.",
    fields: {
      size: {
        type: "number",
        label: "Радиус гекса",
        description: "Расстояние от центра до правой вершины, в мировых единицах.",
        default: 64,
        min: 24,
        max: 120,
        step: 1,
      },
      squash: {
        type: "number",
        label: "Сплющивание",
        description: "Множитель мировой оси Y. Ниже — острее угол взгляда на остров.",
        default: 0.6,
        min: 0.25,
        max: 1,
        step: 0.01,
      },
      wallDepth: {
        type: "number",
        label: "Высота обрыва",
        description: "Насколько скальная стена уходит вниз из-под верхней грани.",
        default: 46,
        min: 0,
        max: 120,
        step: 1,
      },
    },
  },
  camera: {
    label: "Камера",
    description: "Пределы зума и чувствительность ввода.",
    fields: {
      minScale: {
        type: "number",
        label: "Минимальный зум",
        description: "Нижняя граница масштаба камеры.",
        default: 0.4,
        min: 0.1,
        max: 2,
        step: 0.05,
      },
      maxScale: {
        type: "number",
        label: "Максимальный зум",
        description: "Верхняя граница масштаба камеры.",
        default: 4,
        min: 1,
        max: 8,
        step: 0.1,
      },
      wheelZoomSensitivity: {
        type: "number",
        label: "Чувствительность колеса",
        description: "Во сколько раз шаг колеса меняет масштаб.",
        default: 0.0022,
        min: 0.0002,
        max: 0.01,
        step: 0.0001,
      },
      pinchZoomSensitivity: {
        type: "number",
        label: "Чувствительность пинча",
        description: "То же для щипка на трекпаде (wheel с ctrlKey).",
        default: 0.02,
        min: 0.002,
        max: 0.08,
        step: 0.001,
      },
      dragSlop: {
        type: "int",
        label: "Порог перетаскивания",
        description: "Сколько пикселей можно проехать курсором, чтобы клик всё ещё считался кликом.",
        default: 5,
        min: 0,
        max: 40,
      },
      panInertiaFriction: {
        type: "number",
        label: "Инерция: трение",
        description: "Скорость затухания наката, 1/с. Больше — камера встаёт быстрее.",
        default: 4.2,
        min: 0.5,
        max: 20,
        step: 0.1,
      },
      panInertiaMaxSpeed: {
        type: "number",
        label: "Инерция: предел скорости",
        description: "Потолок стартовой скорости наката, экранных пикселей в секунду.",
        default: 2600,
        min: 100,
        max: 8000,
        step: 50,
      },
      panInertiaMinSpeed: {
        type: "number",
        label: "Инерция: порог запуска",
        description: "Ниже этой скорости отпускания накат не начинается, пикселей в секунду.",
        default: 90,
        min: 0,
        max: 1000,
        step: 10,
      },
    },
  },
  island: {
    label: "Генерация острова",
    description: "Форма острова, разбивка на территории и распределение биомов.",
    fields: {
      seed: {
        type: "int",
        label: "Сид",
        description: "Стартовый сид генератора. Кнопка «Новый остров» в прототипе его перебивает.",
        default: 20260808,
        min: 0,
        max: 4294967295,
      },
      tileCount: {
        type: "int",
        label: "Число гексов",
        description: "Сколько клеток вырастить, пока хватает места.",
        default: 21,
        min: 4,
        max: 120,
      },
      maxSpread: {
        type: "int",
        label: "Радиус разрастания",
        description: "Максимальное удаление клетки от центра в шагах гекса.",
        default: 3,
        min: 1,
        max: 8,
      },
      spreadPenalty: {
        type: "number",
        label: "Штраф за удаление",
        description: "Насколько сильно падает шанс клетки с ростом её удаления от центра.",
        default: 0.5,
        min: 0,
        max: 2,
        step: 0.05,
      },
      growthBias1: {
        type: "number",
        label: "Вес: 1 сосед",
        description: "Шанс прирасти клеткой, у которой один занятый сосед. Тянет длинные отростки.",
        default: 2.6,
        min: 0,
        max: 8,
        step: 0.1,
      },
      growthBias2: {
        type: "number",
        label: "Вес: 2 соседа",
        description: "Шанс прирасти клеткой с двумя занятыми соседями.",
        default: 4.2,
        min: 0,
        max: 8,
        step: 0.1,
      },
      growthBias3: {
        type: "number",
        label: "Вес: 3 соседа",
        description: "Шанс прирасти клеткой с тремя занятыми соседями.",
        default: 2.4,
        min: 0,
        max: 8,
        step: 0.1,
      },
      growthBias4: {
        type: "number",
        label: "Вес: 4 соседа",
        description: "Шанс прирасти клеткой с четырьмя занятыми соседями.",
        default: 0.9,
        min: 0,
        max: 8,
        step: 0.1,
      },
      growthBias5: {
        type: "number",
        label: "Вес: 5 соседей",
        description: "Шанс прирасти клеткой с пятью занятыми соседями.",
        default: 0.4,
        min: 0,
        max: 8,
        step: 0.1,
      },
      growthBias6: {
        type: "number",
        label: "Вес: 6 соседей",
        description: "Шанс закрыть дыру, окружённую со всех сторон.",
        default: 0.2,
        min: 0,
        max: 8,
        step: 0.1,
      },
      patchChance: {
        type: "number",
        label: "Слипание биомов",
        description: "Вероятность скопировать биом у соседа вместо броска по весам.",
        default: 0.42,
        min: 0,
        max: 1,
        step: 0.01,
      },
      wildPocketSize: {
        type: "int",
        label: "Ничья земля",
        description: "Сколько клеток на краю остаются без владельца.",
        default: 3,
        min: 0,
        max: 7,
      },
      terrainWeightSnow: {
        type: "number",
        label: "Вес снега",
        description: "Относительный вес биома при броске.",
        default: 1.5,
        min: 0,
        max: 5,
        step: 0.05,
      },
      terrainWeightGrass: {
        type: "number",
        label: "Вес луга",
        description: "Относительный вес биома при броске.",
        default: 1,
        min: 0,
        max: 5,
        step: 0.05,
      },
      terrainWeightForest: {
        type: "number",
        label: "Вес леса",
        description: "Относительный вес биома при броске.",
        default: 0.85,
        min: 0,
        max: 5,
        step: 0.05,
      },
      terrainWeightSand: {
        type: "number",
        label: "Вес пустоши",
        description: "Относительный вес биома при броске.",
        default: 1.05,
        min: 0,
        max: 5,
        step: 0.05,
      },
      terrainWeightIceInner: {
        type: "number",
        label: "Вес льда: внутри",
        description: "Вес льда для клетки с тремя и более занятыми соседями.",
        default: 0.5,
        min: 0,
        max: 5,
        step: 0.05,
      },
      terrainWeightIceEdge: {
        type: "number",
        label: "Вес льда: на краю",
        description: "Вес льда для клетки с тремя открытыми сторонами.",
        default: 1.4,
        min: 0,
        max: 5,
        step: 0.05,
      },
      terrainWeightIceExposed: {
        type: "number",
        label: "Вес льда: на мысу",
        description: "Вес льда для клетки с четырьмя и более открытыми сторонами.",
        default: 2.6,
        min: 0,
        max: 5,
        step: 0.05,
      },
    },
  },
  render: {
    label: "Отрисовка",
    description: "Граница территории, курсор, скалы и декор.",
    fields: {
      territoryBorderEnabled: {
        type: "boolean",
        label: "Рисовать границу",
        description: "Выключает контур территории целиком.",
        default: true,
      },
      borderOuterWidth: {
        type: "number",
        label: "Граница: внешняя",
        description: "Толщина тёмного нижнего слоя контура.",
        default: 11,
        min: 0,
        max: 24,
        step: 0.2,
      },
      borderOuterColor: {
        type: "color",
        label: "Граница: цвет внешней",
        description: "Тёмный слой контура территории.",
        default: "#0b3f9c",
      },
      borderInnerWidth: {
        type: "number",
        label: "Граница: внутренняя",
        description: "Толщина яркого слоя поверх тёмного.",
        default: 7.4,
        min: 0,
        max: 24,
        step: 0.2,
      },
      borderInnerColor: {
        type: "color",
        label: "Граница: цвет внутренней",
        description: "Яркий слой контура территории.",
        default: "#2f83f0",
      },
      borderSheenWidth: {
        type: "number",
        label: "Граница: блик",
        description: "Толщина тонкого блика по центру контура.",
        default: 1.6,
        min: 0,
        max: 8,
        step: 0.1,
      },
      borderSheenColor: {
        type: "color",
        label: "Граница: цвет блика",
        description: "Цвет тонкого блика по центру контура.",
        default: "#8fc4ff",
      },
      borderSheenAlpha: {
        type: "number",
        label: "Граница: прозрачность блика",
        description: "Непрозрачность блика.",
        default: 0.28,
        min: 0,
        max: 1,
        step: 0.01,
      },
      hoverFillColor: {
        type: "color",
        label: "Наведение: заливка",
        description: "Цвет подсветки гекса под курсором.",
        default: "#ffffff",
      },
      hoverFillAlpha: {
        type: "number",
        label: "Наведение: прозрачность заливки",
        description: "Непрозрачность подсветки под курсором.",
        default: 0.14,
        min: 0,
        max: 1,
        step: 0.01,
      },
      hoverLineColor: {
        type: "color",
        label: "Наведение: обводка",
        description: "Цвет контура гекса под курсором.",
        default: "#ffffff",
      },
      hoverLineAlpha: {
        type: "number",
        label: "Наведение: прозрачность обводки",
        description: "Непрозрачность контура под курсором.",
        default: 0.85,
        min: 0,
        max: 1,
        step: 0.01,
      },
      hoverLineWidth: {
        type: "number",
        label: "Наведение: толщина обводки",
        description: "Толщина контура гекса под курсором.",
        default: 2.5,
        min: 0,
        max: 10,
        step: 0.1,
      },
      selectColor: {
        type: "color",
        label: "Выбор: цвет",
        description: "Цвет обводки и свечения выбранного гекса.",
        default: "#ffd479",
      },
      selectLineWidth: {
        type: "number",
        label: "Выбор: толщина",
        description: "Толщина обводки выбранного гекса.",
        default: 5,
        min: 0,
        max: 14,
        step: 0.1,
      },
      selectGlowBlur: {
        type: "number",
        label: "Выбор: свечение",
        description: "Радиус размытия свечения вокруг выбранного гекса.",
        default: 14,
        min: 0,
        max: 40,
        step: 1,
      },
      rockTopColor: {
        type: "color",
        label: "Скала: верх",
        description: "Светлая кромка обрыва сразу под верхней гранью.",
        default: "#adc2ce",
      },
      rockBottomColor: {
        type: "color",
        label: "Скала: низ",
        description: "Тёмный мокрый камень у подошвы обрыва.",
        default: "#35536a",
      },
      tileRimWidth: {
        type: "number",
        label: "Обводка гекса",
        description: "Толщина контура верхней грани клетки.",
        default: 1.4,
        min: 0,
        max: 6,
        step: 0.1,
      },
      decorOverflowTerrain: {
        type: "enum",
        label: "Декор за краем",
        description: "Биом, чей декор не обрезается по краю клетки (деревья торчат вверх).",
        default: "forest",
        options: TERRAIN_OPTIONS,
      },
    },
  },
  terrain: {
    label: "Биомы",
    description: "Название и три тона каждого биома: верхняя грань, кромка, подмешивание в скалу.",
    fields: {
      snowLabel: {
        type: "string",
        label: "Снег: название",
        description: "Подпись биома в панели.",
        default: "Снег",
        maxLength: 32,
      },
      snowTop: {
        type: "color",
        label: "Снег: верх",
        description: "Плоский цвет верхней грани.",
        default: "#f2f6f9",
      },
      snowRim: {
        type: "color",
        label: "Снег: кромка",
        description: "Тон обводки грани и земляной кромки обрыва.",
        default: "#d3e0ea",
      },
      snowWall: {
        type: "color",
        label: "Снег: скала",
        description: "Тон, подмешиваемый в стену обрыва.",
        default: "#7d94a4",
      },
      grassLabel: {
        type: "string",
        label: "Луг: название",
        description: "Подпись биома в панели.",
        default: "Луг",
        maxLength: 32,
      },
      grassTop: {
        type: "color",
        label: "Луг: верх",
        description: "Плоский цвет верхней грани.",
        default: "#93c24a",
      },
      grassRim: {
        type: "color",
        label: "Луг: кромка",
        description: "Тон обводки грани и земляной кромки обрыва.",
        default: "#6f9f34",
      },
      grassWall: {
        type: "color",
        label: "Луг: скала",
        description: "Тон, подмешиваемый в стену обрыва.",
        default: "#6f8b74",
      },
      iceLabel: {
        type: "string",
        label: "Лёд: название",
        description: "Подпись биома в панели.",
        default: "Лёд",
        maxLength: 32,
      },
      iceTop: {
        type: "color",
        label: "Лёд: верх",
        description: "Плоский цвет верхней грани.",
        default: "#c5dee8",
      },
      iceRim: {
        type: "color",
        label: "Лёд: кромка",
        description: "Тон обводки грани и земляной кромки обрыва.",
        default: "#9dc2d4",
      },
      iceWall: {
        type: "color",
        label: "Лёд: скала",
        description: "Тон, подмешиваемый в стену обрыва.",
        default: "#6f8fa4",
      },
      forestLabel: {
        type: "string",
        label: "Лес: название",
        description: "Подпись биома в панели.",
        default: "Лес",
        maxLength: 32,
      },
      forestTop: {
        type: "color",
        label: "Лес: верх",
        description: "Плоский цвет верхней грани.",
        default: "#eaf1f6",
      },
      forestRim: {
        type: "color",
        label: "Лес: кромка",
        description: "Тон обводки грани и земляной кромки обрыва.",
        default: "#cbdae6",
      },
      forestWall: {
        type: "color",
        label: "Лес: скала",
        description: "Тон, подмешиваемый в стену обрыва.",
        default: "#77909f",
      },
      sandLabel: {
        type: "string",
        label: "Пустошь: название",
        description: "Подпись биома в панели.",
        default: "Пустошь",
        maxLength: 32,
      },
      sandTop: {
        type: "color",
        label: "Пустошь: верх",
        description: "Плоский цвет верхней грани.",
        default: "#e6dcc3",
      },
      sandRim: {
        type: "color",
        label: "Пустошь: кромка",
        description: "Тон обводки грани и земляной кромки обрыва.",
        default: "#cbbe9c",
      },
      sandWall: {
        type: "color",
        label: "Пустошь: скала",
        description: "Тон, подмешиваемый в стену обрыва.",
        default: "#8b8b7e",
      },
    },
  },
  background: {
    label: "Фон",
    description: "Небо и шейдерные облака на отдельном WebGL-слое под картой.",
    fields: {
      skyTopColor: {
        type: "color",
        label: "Небо: верх",
        description: "Верхняя точка градиента неба.",
        default: "#a4c6dd",
      },
      skyMidColor: {
        type: "color",
        label: "Небо: середина",
        description: "Средняя точка градиента неба.",
        default: "#c6dded",
      },
      skyMidStop: {
        type: "number",
        label: "Небо: позиция середины",
        description: "Где по высоте экрана стоит средняя точка градиента.",
        default: 0.45,
        min: 0,
        max: 1,
        step: 0.01,
      },
      skyBottomColor: {
        type: "color",
        label: "Небо: низ",
        description: "Нижняя точка градиента неба.",
        default: "#7ca2c0",
      },
      cloudsEnabled: {
        type: "boolean",
        label: "Рисовать облака",
        description: "Выключает шейдерные облака целиком, оставляя чистый градиент неба.",
        default: true,
      },
      cloudDriftSpeed: {
        type: "number",
        label: "Облака: скорость",
        description: "Насколько быстро клубы плывут сами по себе, без ввода.",
        default: 0.035,
        min: 0,
        max: 0.4,
        step: 0.005,
      },
      cloudNoiseScale: {
        type: "number",
        label: "Облака: масштаб шума",
        description: "Больше — мельче и чаще клубы на экране.",
        default: 2.4,
        min: 0.3,
        max: 12,
        step: 0.1,
      },
      cloudOctaves: {
        type: "int",
        label: "Облака: октавы",
        description: "Число слоёв фрактального шума. Больше — детальнее и дороже.",
        default: 5,
        min: 1,
        max: 8,
      },
      cloudCoverage: {
        type: "number",
        label: "Облака: покрытие",
        description: "Порог плотности. Меньше — небо затянуто плотнее.",
        default: 0.47,
        min: 0,
        max: 1,
        step: 0.01,
      },
      cloudSoftness: {
        type: "number",
        label: "Облака: мягкость края",
        description: "Ширина растушёвки края клуба. Меньше — жёсткие пятна.",
        default: 0.24,
        min: 0.01,
        max: 0.6,
        step: 0.01,
      },
      cloudWarp: {
        type: "number",
        label: "Облака: закрутка",
        description: "Сила искажения координат шума самим шумом. Даёт клубящуюся форму.",
        default: 1.7,
        min: 0,
        max: 4,
        step: 0.05,
      },
      cloudLightColor: {
        type: "color",
        label: "Облака: свет",
        description: "Тон освещённой верхушки клуба.",
        default: "#ffffff",
      },
      cloudWarmColor: {
        type: "color",
        label: "Облака: тёплый тон",
        description: "Тёплая подмешка в плотной середине клуба.",
        default: "#fdf1e2",
      },
      cloudShadowColor: {
        type: "color",
        label: "Облака: тень",
        description: "Тон затенённого низа клуба.",
        default: "#7d9fbe",
      },
      parallax: {
        type: "number",
        label: "Параллакс",
        description: "Во сколько раз облака отстают от острова при панораме.",
        default: 0.22,
        min: 0,
        max: 1,
        step: 0.01,
      },
    },
  },
} as const satisfies Schema;

/** The values object the game consumes, typed straight off `SCHEMA`. */
type GameConfig = ConfigOf<typeof SCHEMA>;

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const DEFAULT_MAX_LENGTH = 64;

type MutableConfig = Record<string, Record<string, ConfigValue>>;

function groupEntries(): [string, (typeof SCHEMA)[keyof typeof SCHEMA]][] {
  return Object.entries(SCHEMA);
}

function fieldEntries(group: (typeof SCHEMA)[keyof typeof SCHEMA]): [string, Field][] {
  return Object.entries(group.fields);
}

function buildDefaults(): GameConfig {
  const result: MutableConfig = {};
  for (const [groupKey, group] of groupEntries()) {
    const values: Record<string, ConfigValue> = {};
    for (const [fieldKey, field] of fieldEntries(group)) {
      values[fieldKey] = field.default;
    }
    result[groupKey] = values;
  }
  return result as GameConfig;
}

/** Fresh copy of the schema defaults. Never shared, so callers can mutate it. */
const DEFAULTS: GameConfig = buildDefaults();

/** Slider granularity of a numeric field. */
function stepOf(field: Field): number {
  if (field.type === "int") {
    return field.step ?? 1;
  }
  if (field.type === "number") {
    return field.step ?? 0.01;
  }
  return 1;
}

function checkField(field: Field, value: unknown, path: string, issues: ValidationIssue[]): ConfigValue | undefined {
  if (field.type === "boolean") {
    if (typeof value !== "boolean") {
      issues.push({ path, message: "ожидалось true или false" });
      return undefined;
    }
    return value;
  }
  if (field.type === "color") {
    if (typeof value !== "string" || !COLOR_PATTERN.test(value)) {
      issues.push({ path, message: "ожидался цвет вида #rrggbb" });
      return undefined;
    }
    return value.toLowerCase();
  }
  if (field.type === "string") {
    if (typeof value !== "string") {
      issues.push({ path, message: "ожидалась строка" });
      return undefined;
    }
    const limit = field.maxLength ?? DEFAULT_MAX_LENGTH;
    if (value.length > limit) {
      issues.push({ path, message: `строка длиннее ${limit} символов` });
      return undefined;
    }
    return value;
  }
  if (field.type === "enum") {
    const allowed = field.options.map((option) => option.value);
    if (typeof value !== "string" || !allowed.includes(value)) {
      issues.push({ path, message: `ожидалось одно из: ${allowed.join(", ")}` });
      return undefined;
    }
    return value;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push({ path, message: "ожидалось число" });
    return undefined;
  }
  if (field.type === "int" && !Number.isInteger(value)) {
    issues.push({ path, message: "ожидалось целое число" });
    return undefined;
  }
  if (value < field.min || value > field.max) {
    issues.push({ path, message: `вне диапазона ${field.min}…${field.max}` });
    return undefined;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks a raw values object against the schema. Unknown groups and unknown
 * keys are rejected rather than dropped: a typo in the file has to be loud.
 */
function validateConfig(raw: unknown): ValidationResult<GameConfig> {
  if (!isPlainObject(raw)) {
    return { ok: false, issues: [{ path: "", message: "ожидался объект" }] };
  }
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(SCHEMA, key)) {
      issues.push({ path: key, message: "неизвестная группа" });
    }
  }
  const result: MutableConfig = {};
  for (const [groupKey, group] of groupEntries()) {
    const rawGroup = raw[groupKey];
    if (!isPlainObject(rawGroup)) {
      issues.push({ path: groupKey, message: "ожидался объект" });
      continue;
    }
    for (const key of Object.keys(rawGroup)) {
      if (!Object.hasOwn(group.fields, key)) {
        issues.push({ path: `${groupKey}.${key}`, message: "неизвестное поле" });
      }
    }
    const values: Record<string, ConfigValue> = {};
    for (const [fieldKey, field] of fieldEntries(group)) {
      const path = `${groupKey}.${fieldKey}`;
      if (!Object.hasOwn(rawGroup, fieldKey)) {
        issues.push({ path, message: "поле отсутствует" });
        continue;
      }
      const checked = checkField(field, rawGroup[fieldKey], path, issues);
      if (checked !== undefined) {
        values[fieldKey] = checked;
      }
    }
    result[groupKey] = values;
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: result as GameConfig };
}

/** Same as `validateConfig`, but throws instead of reporting. */
function parseConfig(raw: unknown): GameConfig {
  const result = validateConfig(raw);
  if (!result.ok) {
    const details = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Конфиг не проходит валидацию — ${details}`);
  }
  return result.value;
}

function cloneConfig(value: GameConfig): GameConfig {
  const source = value as unknown as MutableConfig;
  const result: MutableConfig = {};
  for (const [groupKey, group] of Object.entries(source)) {
    result[groupKey] = { ...group };
  }
  return result as GameConfig;
}

/**
 * Renders the values in schema order, pretty-printed and newline-terminated, so
 * a save produces a diff of exactly the fields that changed.
 */
function serializeConfig(value: GameConfig): string {
  const source = value as unknown as MutableConfig;
  const ordered: MutableConfig = {};
  for (const [groupKey, group] of groupEntries()) {
    const values: Record<string, ConfigValue> = {};
    for (const [fieldKey] of fieldEntries(group)) {
      values[fieldKey] = source[groupKey]![fieldKey]!;
    }
    ordered[groupKey] = values;
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export type { GameConfig };
export { DEFAULTS, SCHEMA, cloneConfig, parseConfig, serializeConfig, stepOf, validateConfig };
