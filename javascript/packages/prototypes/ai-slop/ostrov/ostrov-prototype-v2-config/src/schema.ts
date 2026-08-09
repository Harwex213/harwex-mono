import type {
  ConfigOf,
  ConfigValue,
  EntityDescriptor,
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

/** Where a building may stand. `any` means the biome does not matter. */
const BUILD_TERRAIN_OPTIONS = [
  { value: "any", label: "Любой" },
  { value: "snow", label: "Снег" },
  { value: "grass", label: "Луг" },
  { value: "ice", label: "Лёд" },
  { value: "forest", label: "Лес" },
  { value: "sand", label: "Пустошь" },
] as const;

/** The island economy. `none` marks a building that produces nothing. */
const RESOURCE_OPTIONS = [
  { value: "none", label: "Нет" },
  { value: "wood", label: "Дерево" },
  { value: "stone", label: "Камень" },
  { value: "food", label: "Еда" },
  { value: "gold", label: "Золото" },
] as const;

/** Enemy units an enemy building can spawn. Ids match the `enemies` group. */
const ENEMY_UNIT_OPTIONS = [
  { value: "raider", label: "Разбойник" },
  { value: "wolf", label: "Волк" },
  { value: "brute", label: "Громила" },
] as const;

/** Group of the tech tree, so the page and the validation share one name. */
const BUILDINGS_GROUP = "buildings";

/** Field holding the prerequisite of a building. */
const PREREQUISITE_FIELD = "requires";

/** Value of `requires` for a building available from the first minute. */
const NO_PREREQUISITE = "none";

/** Fields holding the node position on the tech-tree canvas. */
const NODE_X_FIELD = "nodeX";

const NODE_Y_FIELD = "nodeY";

/**
 * What a building needs built first. `none` means the building is available from
 * the start; every other value is an id of the `buildings` group. One building
 * carries one prerequisite, which is why this is a single-select enum.
 * `assertPrerequisiteOptions` keeps the list and the entity ids in step.
 */
const BUILDING_PREREQUISITE_OPTIONS = [
  { value: "none", label: "С начала игры" },
  { value: "castle1", label: "Замок I ур." },
  { value: "barracks1", label: "Казарма I ур." },
  { value: "hut1", label: "Хижина I ур." },
  { value: "sawmill1", label: "Лесопилка I ур." },
  { value: "mill1", label: "Мельница I ур." },
  { value: "mine1", label: "Шахта I ур." },
  { value: "islandController1", label: "Контроллер острова I ур." },
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
        description: "Нижняя граница масштаба камеры. Должна быть мала настолько, чтобы мир влезал в экран целиком.",
        default: 0.15,
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
      boundMargin: {
        type: "number",
        label: "Запас за краем мира",
        description: "Сколько пустоты за габаритами мира камера ещё показывает, в мировых единицах.",
        default: 420,
        min: 0,
        max: 4000,
        step: 20,
      },
    },
  },
  island: {
    label: "Форма острова",
    description: "Шаблон одного острова: силуэт и распределение биомов. Общий для всех островов мира; сид и размеры живут в группе «Мир».",
    fields: {
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
  world: {
    label: "Мир",
    description:
      "Три кольца островов вокруг центра мира: Земли босса, Дикие земли, Окраина. Радиусы заданы в мировых единицах, зазор — в шагах гекса.",
    fields: {
      seed: {
        type: "int",
        label: "Сид мира",
        description: "Один сид на весь мир: и раскладка островов, и их форма, и биомы.",
        default: 20260809,
        min: 0,
        max: 4294967295,
      },
      bossZoneRadius: {
        type: "number",
        label: "Радиус Земель босса",
        description: "Граница внутренней зоны, в мировых единицах. Внутри стоит один остров с боссом.",
        default: 560,
        min: 200,
        max: 4000,
        step: 10,
      },
      wildZoneRadius: {
        type: "number",
        label: "Радиус Диких земель",
        description: "Граница средней зоны. Дикие острова стоят между ней и границей Земель босса.",
        default: 1800,
        min: 400,
        max: 8000,
        step: 20,
      },
      peripheralZoneRadius: {
        type: "number",
        label: "Радиус Окраины",
        description: "Внешний край мира: дальше островов не бывает.",
        default: 3400,
        min: 600,
        max: 16000,
        step: 20,
      },
      bossIslandSize: {
        type: "int",
        label: "Размер острова босса",
        description: "Сколько гексов в центральном острове.",
        default: 12,
        min: 3,
        max: 40,
      },
      wildIslandCount: {
        type: "int",
        label: "Диких островов",
        description: "Сколько островов раскидать по Диким землям.",
        default: 5,
        min: 0,
        max: 24,
      },
      wildIslandSizeMin: {
        type: "int",
        label: "Дикий остров: минимум гексов",
        description: "Нижняя граница размера дикого острова.",
        default: 6,
        min: 3,
        max: 40,
      },
      wildIslandSizeMax: {
        type: "int",
        label: "Дикий остров: максимум гексов",
        description: "Верхняя граница размера дикого острова.",
        default: 9,
        min: 3,
        max: 40,
      },
      peripheralIslandCount: {
        type: "int",
        label: "Островов на Окраине",
        description: "Сколько нейтральных островов раскидать по Окраине, не считая двух стартовых.",
        default: 8,
        min: 0,
        max: 40,
      },
      peripheralIslandSizeMin: {
        type: "int",
        label: "Остров Окраины: минимум гексов",
        description: "Нижняя граница размера острова Окраины.",
        default: 3,
        min: 3,
        max: 40,
      },
      peripheralIslandSizeMax: {
        type: "int",
        label: "Остров Окраины: максимум гексов",
        description: "Верхняя граница размера острова Окраины.",
        default: 6,
        min: 3,
        max: 40,
      },
      startIslandSize: {
        type: "int",
        label: "Размер стартового острова",
        description: "Сколько гексов в острове игрока и в острове врага.",
        default: 9,
        min: 3,
        max: 40,
      },
      minIslandGap: {
        type: "int",
        label: "Зазор между островами",
        description: "Минимальное расстояние между клетками разных островов, в шагах гекса. 2 — ровно одна пустая клетка между ними.",
        default: 2,
        min: 1,
        max: 8,
      },
      enemyStartDistance: {
        type: "number",
        label: "Враг: удаление от игрока",
        description: "На каком расстоянии от стартового острова игрока ставится остров врага, в мировых единицах.",
        default: 900,
        min: 200,
        max: 8000,
        step: 20,
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
      enemyBorderOuterColor: {
        type: "color",
        label: "Граница врага: внешняя",
        description: "Тёмный слой контура территории врага.",
        default: "#7a1414",
      },
      enemyBorderInnerColor: {
        type: "color",
        label: "Граница врага: внутренняя",
        description: "Яркий слой контура территории врага.",
        default: "#e2483c",
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
        default: 4.2,
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
        default: 0.56,
        min: 0,
        max: 1,
        step: 0.01,
      },
      cloudSoftness: {
        type: "number",
        label: "Облака: мягкость края",
        description: "Ширина растушёвки края клуба. Меньше — жёсткие пятна.",
        default: 0.18,
        min: 0.01,
        max: 0.6,
        step: 0.01,
      },
      cloudWarp: {
        type: "number",
        label: "Облака: закрутка",
        description: "Сила искажения координат шума самим шумом. Даёт клубящуюся форму.",
        default: 1.2,
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
  buildings: {
    label: "Здания",
    description: "Постройки игрока: цена, стройка, живучесть и производство. Все здания делят один набор полей.",
    entityLabel: "Здание",
    fields: {
      requires: {
        type: "enum",
        label: "Что нужно построить раньше",
        description: "Здание, без которого это не заложить. «С начала игры» — доступно сразу.",
        default: "none",
        options: BUILDING_PREREQUISITE_OPTIONS,
      },
      costWood: {
        type: "int",
        label: "Цена: дерево",
        description: "Сколько дерева уходит на постройку.",
        default: 60,
        min: 0,
        max: 5000,
      },
      costStone: {
        type: "int",
        label: "Цена: камень",
        description: "Сколько камня уходит на постройку.",
        default: 20,
        min: 0,
        max: 5000,
      },
      costGold: {
        type: "int",
        label: "Цена: золото",
        description: "Сколько золота уходит на постройку.",
        default: 0,
        min: 0,
        max: 5000,
      },
      buildTimeSec: {
        type: "int",
        label: "Время стройки",
        description: "Секунды от закладки до готовности при одном рабочем.",
        default: 45,
        min: 1,
        max: 3600,
      },
      maxHp: {
        type: "int",
        label: "Прочность",
        description: "Запас здоровья готового здания.",
        default: 400,
        min: 10,
        max: 20000,
      },
      workerSlots: {
        type: "int",
        label: "Рабочие места",
        description: "Сколько рабочих здание вмещает. Добыча растёт с числом занятых мест.",
        default: 2,
        min: 0,
        max: 20,
      },
      productionResource: {
        type: "enum",
        label: "Что производит",
        description: "Ресурс, который здание кладёт в казну.",
        default: "none",
        options: RESOURCE_OPTIONS,
      },
      productionPerMin: {
        type: "number",
        label: "Добыча в минуту",
        description: "Сколько единиц ресурса даёт здание за минуту на полном штате.",
        default: 0,
        min: 0,
        max: 500,
        step: 0.5,
      },
      terrain: {
        type: "enum",
        label: "Биом под постройку",
        description: "Биом гекса, на котором здание разрешено ставить.",
        default: "any",
        options: BUILD_TERRAIN_OPTIONS,
      },
      claimRadius: {
        type: "int",
        label: "Радиус захвата",
        description: "Сколько колец соседних гексов здание забирает под игрока. 0 — не забирает.",
        default: 0,
        min: 0,
        max: 6,
      },
      note: {
        type: "string",
        label: "Роль",
        description: "Одна строка о том, зачем здание нужно.",
        default: "",
        maxLength: 96,
      },
      nodeX: {
        type: "int",
        label: "Узел: X",
        description: "Положение карточки на дереве технологий. 0 вместе с Y — авто-раскладка.",
        default: 0,
        min: -4000,
        max: 4000,
      },
      nodeY: {
        type: "int",
        label: "Узел: Y",
        description: "Положение карточки на дереве технологий. 0 вместе с X — авто-раскладка.",
        default: 0,
        min: -4000,
        max: 4000,
      },
    },
    entities: {
      castle1: {
        label: "Замок I ур.",
        description: "Главное здание острова. Дорогое и долгое, зато держит удар и собирает налог.",
        overrides: {
          costWood: 800,
          costStone: 600,
          costGold: 200,
          buildTimeSec: 600,
          maxHp: 5000,
          workerSlots: 6,
          productionResource: "gold",
          productionPerMin: 6,
          claimRadius: 2,
          note: "Центр острова: открывает постройки и хранит запасы.",
        },
      },
      barracks1: {
        label: "Казарма I ур.",
        description: "Готовит отряды. Ресурсов не даёт, поэтому рабочих мест у неё нет.",
        overrides: {
          requires: "castle1",
          costWood: 260,
          costStone: 140,
          costGold: 60,
          buildTimeSec: 180,
          maxHp: 1400,
          workerSlots: 0,
          note: "Готовит отряды, ресурсов не даёт.",
        },
      },
      hut1: {
        label: "Хижина I ур.",
        description: "Самая дешёвая постройка. Даёт крышу рабочим и ничего не добывает.",
        overrides: {
          costWood: 60,
          costStone: 20,
          buildTimeSec: 45,
          maxHp: 400,
          workerSlots: 3,
          terrain: "grass",
          note: "Дом на трёх рабочих.",
        },
      },
      sawmill1: {
        label: "Лесопилка I ур.",
        description: "Рубит лес вокруг себя, поэтому стоит только на лесном гексе.",
        overrides: {
          costWood: 120,
          costStone: 40,
          costGold: 10,
          buildTimeSec: 90,
          maxHp: 700,
          workerSlots: 3,
          productionResource: "wood",
          productionPerMin: 12,
          terrain: "forest",
          note: "Главный источник дерева.",
        },
      },
      mill1: {
        label: "Мельница I ур.",
        description: "Мелет зерно с луга. Даёт еду, которой кормятся отряды.",
        overrides: {
          costWood: 140,
          costStone: 60,
          costGold: 15,
          buildTimeSec: 110,
          maxHp: 700,
          workerSlots: 3,
          productionResource: "food",
          productionPerMin: 10,
          terrain: "grass",
          note: "Главный источник еды.",
        },
      },
      mine1: {
        label: "Шахта I ур.",
        description: "Бьёт породу в пустоши. Камня даёт мало, но без него не растут стены.",
        overrides: {
          costWood: 100,
          costStone: 90,
          costGold: 25,
          buildTimeSec: 150,
          maxHp: 900,
          workerSlots: 4,
          productionResource: "stone",
          productionPerMin: 8,
          terrain: "sand",
          note: "Главный источник камня.",
        },
      },
      islandController1: {
        label: "Контроллер острова I ур.",
        description: "Ставится на границе и забирает соседние гексы под игрока. Сам ничего не добывает.",
        overrides: {
          requires: "castle1",
          costWood: 200,
          costStone: 200,
          costGold: 150,
          buildTimeSec: 240,
          maxHp: 1500,
          workerSlots: 1,
          claimRadius: 2,
          note: "Расширяет территорию на два кольца гексов.",
        },
      },
    },
  },
  units: {
    label: "Отряды",
    description: "Заготовка: состав и числа игрок ещё не задавал. Поля общие для всех отрядов.",
    entityLabel: "Отряд",
    fields: {
      costFood: {
        type: "int",
        label: "Цена: еда",
        description: "Сколько еды уходит на найм.",
        default: 25,
        min: 0,
        max: 2000,
      },
      costWood: {
        type: "int",
        label: "Цена: дерево",
        description: "Сколько дерева уходит на найм.",
        default: 0,
        min: 0,
        max: 2000,
      },
      costGold: {
        type: "int",
        label: "Цена: золото",
        description: "Сколько золота уходит на найм.",
        default: 0,
        min: 0,
        max: 2000,
      },
      trainTimeSec: {
        type: "int",
        label: "Время найма",
        description: "Секунды в очереди казармы.",
        default: 20,
        min: 1,
        max: 600,
      },
      maxHp: {
        type: "int",
        label: "Здоровье",
        description: "Запас здоровья отряда.",
        default: 100,
        min: 1,
        max: 5000,
      },
      damage: {
        type: "int",
        label: "Урон",
        description: "Урон одной атаки.",
        default: 10,
        min: 0,
        max: 2000,
      },
      attackSpeed: {
        type: "number",
        label: "Скорость атаки",
        description: "Атак в секунду.",
        default: 1,
        min: 0.1,
        max: 5,
        step: 0.05,
      },
      moveSpeed: {
        type: "number",
        label: "Скорость шага",
        description: "Гексов в секунду.",
        default: 1,
        min: 0.1,
        max: 5,
        step: 0.05,
      },
      attackRangeHex: {
        type: "number",
        label: "Дальность",
        description: "Дальность атаки в гексах. 1 — ближний бой.",
        default: 1,
        min: 0.5,
        max: 12,
        step: 0.5,
      },
      note: {
        type: "string",
        label: "Роль",
        description: "Одна строка о том, зачем отряд нужен.",
        default: "",
        maxLength: 96,
      },
    },
    entities: {
      worker: {
        label: "Рабочий",
        description: "Заготовка. Строит и добывает, в бою почти бесполезен.",
        overrides: {
          costFood: 20,
          trainTimeSec: 12,
          maxHp: 80,
          damage: 4,
          attackSpeed: 0.8,
          moveSpeed: 1.2,
          note: "Строит и добывает.",
        },
      },
      swordsman: {
        label: "Мечник",
        description: "Заготовка. Дешёвый ближний бой, держит линию.",
        overrides: {
          costFood: 40,
          costGold: 10,
          trainTimeSec: 25,
          maxHp: 220,
          damage: 18,
          attackSpeed: 1.1,
          note: "Держит линию.",
        },
      },
      archer: {
        label: "Лучник",
        description: "Заготовка. Бьёт издалека, но мрёт в ближнем бою.",
        overrides: {
          costFood: 30,
          costWood: 20,
          trainTimeSec: 30,
          maxHp: 130,
          damage: 14,
          attackSpeed: 0.9,
          moveSpeed: 1.1,
          attackRangeHex: 3.5,
          note: "Бьёт из-за спины мечников.",
        },
      },
    },
  },
  enemies: {
    label: "Враги",
    description: "Заготовка: состав и числа игрок ещё не задавал. Поля общие для всех врагов.",
    entityLabel: "Враг",
    fields: {
      maxHp: {
        type: "int",
        label: "Здоровье",
        description: "Запас здоровья врага.",
        default: 120,
        min: 1,
        max: 20000,
      },
      damage: {
        type: "int",
        label: "Урон",
        description: "Урон одной атаки.",
        default: 12,
        min: 0,
        max: 2000,
      },
      attackSpeed: {
        type: "number",
        label: "Скорость атаки",
        description: "Атак в секунду.",
        default: 1,
        min: 0.1,
        max: 5,
        step: 0.05,
      },
      moveSpeed: {
        type: "number",
        label: "Скорость шага",
        description: "Гексов в секунду.",
        default: 1,
        min: 0.1,
        max: 5,
        step: 0.05,
      },
      aggroRadiusHex: {
        type: "number",
        label: "Радиус агра",
        description: "С какого расстояния в гексах враг бросается на цель.",
        default: 2,
        min: 0,
        max: 12,
        step: 0.5,
      },
      rewardGold: {
        type: "int",
        label: "Награда: золото",
        description: "Сколько золота падает за убийство.",
        default: 10,
        min: 0,
        max: 2000,
      },
      rewardFood: {
        type: "int",
        label: "Награда: еда",
        description: "Сколько еды падает за убийство.",
        default: 0,
        min: 0,
        max: 2000,
      },
      note: {
        type: "string",
        label: "Роль",
        description: "Одна строка о повадках врага.",
        default: "",
        maxLength: 96,
      },
    },
    entities: {
      raider: {
        label: "Разбойник",
        description: "Заготовка. Обычный пехотинец лагеря.",
        overrides: {
          maxHp: 140,
          damage: 16,
          moveSpeed: 1.1,
          aggroRadiusHex: 3,
          rewardGold: 14,
          note: "Рядовой противник.",
        },
      },
      wolf: {
        label: "Волк",
        description: "Заготовка. Быстрый и хрупкий, ходит стаей.",
        overrides: {
          maxHp: 90,
          damage: 11,
          attackSpeed: 1.4,
          moveSpeed: 1.8,
          aggroRadiusHex: 4.5,
          rewardGold: 6,
          rewardFood: 8,
          note: "Догоняет отставших.",
        },
      },
      brute: {
        label: "Громила",
        description: "Заготовка. Медленный, но бьёт очень больно.",
        overrides: {
          maxHp: 420,
          damage: 34,
          attackSpeed: 0.6,
          moveSpeed: 0.7,
          aggroRadiusHex: 2.5,
          rewardGold: 40,
          note: "Ломает стены и строй.",
        },
      },
    },
  },
  enemyBuildings: {
    label: "Здания врага",
    description: "Заготовка: состав и числа игрок ещё не задавал. Источники волн на диких гексах.",
    entityLabel: "Постройка врага",
    fields: {
      maxHp: {
        type: "int",
        label: "Прочность",
        description: "Запас здоровья постройки.",
        default: 600,
        min: 1,
        max: 40000,
      },
      spawnIntervalSec: {
        type: "int",
        label: "Интервал спавна",
        description: "Секунды между выпусками врагов.",
        default: 45,
        min: 5,
        max: 600,
      },
      spawnUnit: {
        type: "enum",
        label: "Кого выпускает",
        description: "Враг из группы «Враги», который выходит из постройки.",
        default: "raider",
        options: ENEMY_UNIT_OPTIONS,
      },
      spawnBatch: {
        type: "int",
        label: "Размер выпуска",
        description: "Сколько врагов выходит за один интервал.",
        default: 1,
        min: 1,
        max: 10,
      },
      garrisonCap: {
        type: "int",
        label: "Потолок гарнизона",
        description: "Сколько живых врагов постройка держит на карте. Дальше спавн ждёт.",
        default: 4,
        min: 1,
        max: 40,
      },
      rewardGold: {
        type: "int",
        label: "Награда: золото",
        description: "Сколько золота падает за снос постройки.",
        default: 60,
        min: 0,
        max: 5000,
      },
      note: {
        type: "string",
        label: "Роль",
        description: "Одна строка о том, чем постройка опасна.",
        default: "",
        maxLength: 96,
      },
    },
    entities: {
      camp: {
        label: "Лагерь разбойников",
        description: "Заготовка. Базовый источник разбойников.",
        overrides: {
          maxHp: 600,
          note: "Ровный поток разбойников.",
        },
      },
      den: {
        label: "Волчье логово",
        description: "Заготовка. Выпускает волков парами и часто.",
        overrides: {
          maxHp: 380,
          spawnIntervalSec: 30,
          spawnUnit: "wolf",
          spawnBatch: 2,
          garrisonCap: 6,
          rewardGold: 45,
          note: "Частые быстрые стаи.",
        },
      },
      watchtower: {
        label: "Сторожевая башня",
        description: "Заготовка. Редко, но выпускает громил.",
        overrides: {
          maxHp: 1200,
          spawnIntervalSec: 90,
          spawnUnit: "brute",
          garrisonCap: 2,
          rewardGold: 120,
          note: "Редкие, но тяжёлые гости.",
        },
      },
    },
  },
} as const satisfies Schema;

/** The values object the game consumes, typed straight off `SCHEMA`. */
type GameConfig = ConfigOf<typeof SCHEMA>;

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const DEFAULT_MAX_LENGTH = 64;

/** One filled-in field template: the values of a plain group or of one entity. */
type MutableEntity = Record<string, ConfigValue>;

/** A plain group holds fields, a collection group holds entities. */
type MutableGroup = Record<string, ConfigValue | MutableEntity>;

type MutableConfig = Record<string, MutableGroup>;

/** Both kinds of group read through one shape. `entities` marks a collection. */
type AnyGroup = {
  label: string;
  description: string;
  fields: Record<string, Field>;
  entityLabel?: string;
  entities?: Record<string, EntityDescriptor>;
};

function groupEntries(): [string, AnyGroup][] {
  return Object.entries(SCHEMA);
}

function fieldEntries(group: AnyGroup): [string, Field][] {
  return Object.entries(group.fields);
}

/** Entities of a collection group, or `null` when the group is a plain one. */
function entityEntries(group: AnyGroup): [string, EntityDescriptor][] | null {
  const entities = group.entities;
  if (!entities) {
    return null;
  }
  return Object.entries(entities);
}

/** Template defaults with this entity's overrides applied on top. */
function entityDefaults(group: AnyGroup, entity: EntityDescriptor, path: string): MutableEntity {
  const values: MutableEntity = {};
  for (const [fieldKey, field] of fieldEntries(group)) {
    values[fieldKey] = field.default;
  }
  for (const [key, value] of Object.entries(entity.overrides ?? {})) {
    // A typo here would silently leave the template default in place, so it throws.
    if (!Object.hasOwn(group.fields, key)) {
      throw new Error(`Схема сломана: ${path}.${key} — такого поля нет в шаблоне`);
    }
    values[key] = value;
  }
  return values;
}

function buildDefaults(): GameConfig {
  const result: MutableConfig = {};
  for (const [groupKey, group] of groupEntries()) {
    const entities = entityEntries(group);
    if (entities) {
      const rows: MutableGroup = {};
      for (const [entityKey, entity] of entities) {
        rows[entityKey] = entityDefaults(group, entity, `${groupKey}.${entityKey}`);
      }
      result[groupKey] = rows;
      continue;
    }
    const values: MutableEntity = {};
    for (const [fieldKey, field] of fieldEntries(group)) {
      values[fieldKey] = field.default;
    }
    result[groupKey] = values;
  }
  return result as unknown as GameConfig;
}

/**
 * The prerequisite options repeat the building ids, because a field template
 * cannot point at the entity list that uses it. This catches the two lists
 * drifting apart at load time instead of at play time.
 */
function assertPrerequisiteOptions(): void {
  const ids = Object.keys(SCHEMA.buildings.entities);
  const offered: string[] = BUILDING_PREREQUISITE_OPTIONS.map((option) => option.value).filter(
    (value) => value !== NO_PREREQUISITE,
  );
  for (const id of ids) {
    if (!offered.includes(id)) {
      throw new Error(`Схема сломана: у здания ${id} нет варианта в списке требований`);
    }
  }
  for (const value of offered) {
    if (!ids.includes(value)) {
      throw new Error(`Схема сломана: требование ${value} — такого здания нет`);
    }
  }
}

assertPrerequisiteOptions();

/**
 * Buildings that sit on a cycle of prerequisites, in schema order. A building
 * carries one prerequisite at most, so one walk per building finds every ring.
 * Nothing recurses and every walk stops on a repeat, so a cycle cannot hang the
 * caller — the layout code on the tech-tree page relies on that.
 */
function prerequisiteCycleIds(config: GameConfig): string[] {
  const rows = (config as unknown as MutableConfig)[BUILDINGS_GROUP] as Record<string, MutableEntity>;
  const settled = new Set<string>();
  const onCycle = new Set<string>();
  for (const startId of Object.keys(rows)) {
    const path: string[] = [];
    const seenAt = new Map<string, number>();
    let current = startId;
    while (current !== NO_PREREQUISITE && Object.hasOwn(rows, current) && !settled.has(current)) {
      const repeat = seenAt.get(current);
      if (repeat !== undefined) {
        for (const id of path.slice(repeat)) {
          onCycle.add(id);
        }
        break;
      }
      seenAt.set(current, path.length);
      path.push(current);
      current = String(rows[current]![PREREQUISITE_FIELD]);
    }
    for (const id of path) {
      settled.add(id);
    }
  }
  return Object.keys(rows).filter((id) => onCycle.has(id));
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

/** Checks one filled-in field template — a plain group or one entity of a collection. */
function checkFields(
  group: AnyGroup,
  raw: Record<string, unknown>,
  prefix: string,
  issues: ValidationIssue[],
): MutableEntity {
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(group.fields, key)) {
      issues.push({ path: `${prefix}.${key}`, message: "неизвестное поле" });
    }
  }
  const values: MutableEntity = {};
  for (const [fieldKey, field] of fieldEntries(group)) {
    const path = `${prefix}.${fieldKey}`;
    if (!Object.hasOwn(raw, fieldKey)) {
      issues.push({ path, message: "поле отсутствует" });
      continue;
    }
    const checked = checkField(field, raw[fieldKey], path, issues);
    if (checked !== undefined) {
      values[fieldKey] = checked;
    }
  }
  return values;
}

/** Checks every entity of a collection group. Unknown ids are rejected too. */
function checkEntities(
  group: AnyGroup,
  entities: [string, EntityDescriptor][],
  raw: Record<string, unknown>,
  groupKey: string,
  issues: ValidationIssue[],
): MutableGroup {
  const known = new Set(entities.map(([entityKey]) => entityKey));
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      issues.push({ path: `${groupKey}.${key}`, message: "неизвестная сущность" });
    }
  }
  const rows: MutableGroup = {};
  for (const [entityKey] of entities) {
    const path = `${groupKey}.${entityKey}`;
    const rawEntity = raw[entityKey];
    if (!isPlainObject(rawEntity)) {
      issues.push({ path, message: "ожидался объект" });
      continue;
    }
    rows[entityKey] = checkFields(group, rawEntity, path, issues);
  }
  return rows;
}

/**
 * Checks a raw values object against the schema. Unknown groups, unknown
 * entities and unknown keys are rejected rather than dropped: a typo in the
 * file has to be loud.
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
    const entities = entityEntries(group);
    if (entities) {
      result[groupKey] = checkEntities(group, entities, rawGroup, groupKey, issues);
      continue;
    }
    result[groupKey] = checkFields(group, rawGroup, groupKey, issues);
  }
  // Only worth asking once every building holds a value: a cycle is a property
  // of the whole group, not of one field, and it is rejected here rather than
  // merely flagged in the UI, so no file on disk can ever hold an unbuildable tree.
  if (issues.length === 0) {
    const ring = prerequisiteCycleIds(result as unknown as GameConfig);
    for (const id of ring) {
      issues.push({
        path: `${BUILDINGS_GROUP}.${id}.${PREREQUISITE_FIELD}`,
        message: `требования зациклены: ${ring.join(" ↔ ")} — здание нельзя построить ни при каком порядке`,
      });
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: result as unknown as GameConfig };
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
    const rows: MutableGroup = {};
    for (const [key, entry] of Object.entries(group)) {
      rows[key] = isPlainObject(entry) ? { ...(entry as MutableEntity) } : entry;
    }
    result[groupKey] = rows;
  }
  return result as unknown as GameConfig;
}

/** One field template rewritten in schema order. */
function orderFields(group: AnyGroup, source: MutableEntity): MutableEntity {
  const values: MutableEntity = {};
  for (const [fieldKey] of fieldEntries(group)) {
    values[fieldKey] = source[fieldKey]!;
  }
  return values;
}

/**
 * Renders the values in schema order, pretty-printed and newline-terminated, so
 * a save produces a diff of exactly the fields that changed.
 */
function serializeConfig(value: GameConfig): string {
  const source = value as unknown as MutableConfig;
  const ordered: MutableConfig = {};
  for (const [groupKey, group] of groupEntries()) {
    const rawGroup = source[groupKey]!;
    const entities = entityEntries(group);
    if (entities) {
      const rows: MutableGroup = {};
      for (const [entityKey] of entities) {
        rows[entityKey] = orderFields(group, rawGroup[entityKey] as MutableEntity);
      }
      ordered[groupKey] = rows;
      continue;
    }
    ordered[groupKey] = orderFields(group, rawGroup as MutableEntity);
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export type { AnyGroup as SchemaGroup, GameConfig };
export {
  BUILDINGS_GROUP,
  DEFAULTS,
  NODE_X_FIELD,
  NODE_Y_FIELD,
  NO_PREREQUISITE,
  PREREQUISITE_FIELD,
  SCHEMA,
  cloneConfig,
  entityEntries,
  fieldEntries,
  groupEntries,
  parseConfig,
  prerequisiteCycleIds,
  serializeConfig,
  stepOf,
  validateConfig,
};
