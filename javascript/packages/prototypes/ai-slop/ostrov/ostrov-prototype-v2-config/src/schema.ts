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
  { value: "none", label: "None" },
  { value: "snow", label: "Snow" },
  { value: "grass", label: "Meadow" },
  { value: "ice", label: "Ice" },
  { value: "forest", label: "Forest" },
  { value: "sand", label: "Wasteland" },
] as const;

/** Where a building may stand. `any` means the biome does not matter. */
const BUILD_TERRAIN_OPTIONS = [
  { value: "any", label: "Any" },
  { value: "snow", label: "Snow" },
  { value: "grass", label: "Meadow" },
  { value: "ice", label: "Ice" },
  { value: "forest", label: "Forest" },
  { value: "sand", label: "Wasteland" },
] as const;

/** The island economy. `none` marks a building that produces nothing. */
const RESOURCE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "wood", label: "Wood" },
  { value: "stone", label: "Stone" },
  { value: "food", label: "Food" },
  { value: "gold", label: "Gold" },
] as const;

/** Enemy units an enemy building can spawn. Ids match the `enemies` group. */
const ENEMY_UNIT_OPTIONS = [
  { value: "raider", label: "Raider" },
  { value: "wolf", label: "Wolf" },
  { value: "brute", label: "Brute" },
] as const;

/**
 * Section of the build menu a building sits in. The game groups the panel on
 * this value, so a designer can move a building between sections here instead
 * of in game code.
 */
const BUILDING_CATEGORY_OPTIONS = [
  { value: "core", label: "Core" },
  { value: "economics", label: "Economy" },
  { value: "war", label: "War" },
  { value: "defense", label: "Defence" },
  { value: "magic", label: "Magic" },
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
  { value: "none", label: "From the start" },
  { value: "castle1", label: "Castle I" },
  { value: "barracks1", label: "Barracks I" },
  { value: "hut1", label: "Hut I" },
  { value: "sawmill1", label: "Sawmill I" },
  { value: "mill1", label: "Mill I" },
  { value: "mine1", label: "Mine I" },
  { value: "islandController1", label: "Island controller I" },
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
        default: 0.05,
        min: 0.02,
        max: 2,
        step: 0.01,
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
        default: 1150,
        min: 200,
        max: 4000,
        step: 10,
      },
      wildZoneRadius: {
        type: "number",
        label: "Радиус Диких земель",
        description: "Граница средней зоны. Дикие острова стоят между ней и границей Земель босса.",
        default: 3700,
        min: 400,
        max: 8000,
        step: 20,
      },
      peripheralZoneRadius: {
        type: "number",
        label: "Радиус Окраины",
        description: "Внешний край мира: дальше островов не бывает.",
        default: 7000,
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
        default: 30,
        min: 0,
        max: 80,
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
        default: 47,
        min: 0,
        max: 120,
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
      largeIslandChance: {
        type: "number",
        label: "Шанс большого острова",
        description:
          "С какой вероятностью раскидываемый остров выпадает большим вместо обычного размера своей зоны. Работает в Диких землях и на Окраине; остров босса и два стартовых всегда своего размера.",
        default: 0.1,
        min: 0,
        max: 1,
        step: 0.01,
      },
      largeIslandSizeMin: {
        type: "int",
        label: "Большой остров: минимум гексов",
        description: "Нижняя граница размера большого острова.",
        default: 14,
        min: 3,
        max: 40,
      },
      largeIslandSizeMax: {
        type: "int",
        label: "Большой остров: максимум гексов",
        description: "Верхняя граница размера большого острова.",
        default: 17,
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
      startTerrainMinTiles: {
        type: "int",
        label: "Стартовый остров: клеток на биом",
        description:
          "Сколько клеток каждого биома, нужного зданиям «с начала игры», гарантированно есть на стартовом острове. Без этого лесопилке может не хватить леса.",
        default: 2,
        min: 0,
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
      islandShadowEnabled: {
        type: "boolean",
        label: "Тень острова",
        description: "Мягкое пятно под островом. Без неё остров читается как плоская вырезка.",
        default: true,
      },
      islandShadowColor: {
        type: "color",
        label: "Тень: цвет",
        description: "Тон пятна под островом.",
        default: "#123b57",
      },
      islandShadowOpacity: {
        type: "number",
        label: "Тень: плотность",
        description: "Непрозрачность пятна в его середине.",
        default: 0.32,
        min: 0,
        max: 1,
        step: 0.01,
      },
      islandShadowOffsetX: {
        type: "number",
        label: "Тень: сдвиг вправо",
        description: "Свет падает сверху слева, поэтому пятно уезжает вправо, в мировых единицах.",
        default: 34,
        min: -200,
        max: 200,
        step: 1,
      },
      islandShadowOffsetY: {
        type: "number",
        label: "Тень: сдвиг вниз",
        description: "На сколько мировых единиц центр пятна опускается ниже подошвы обрыва.",
        default: 8,
        min: -200,
        max: 300,
        step: 1,
      },
      islandShadowSpread: {
        type: "number",
        label: "Тень: размер",
        description: "Во сколько раз пятно шире силуэта острова.",
        default: 1.16,
        min: 0.2,
        max: 3,
        step: 0.01,
      },
      islandShadowBlur: {
        type: "number",
        label: "Тень: размытие",
        description: "Доля пятна, отданная под растушёвку края. 0 — резкий эллипс.",
        default: 0.62,
        min: 0,
        max: 1,
        step: 0.01,
      },
    },
  },
  ui: {
    label: "Интерфейс",
    description: "Размеры и длительности накладных панелей: обзорная карта, подсветка новых построек, панель строительства.",
    fields: {
      minimapSize: {
        type: "int",
        label: "Обзорная карта: сторона",
        description:
          "Сторона квадрата обзорной карты в экранных пикселях. Меньше — метки внешнего кольца сливаются в полосу, больше — карта съедает угол экрана.",
        default: 296,
        min: 160,
        max: 480,
      },
      minimapPlayerMark: {
        type: "number",
        label: "Обзорная карта: метка игрока",
        description: "Радиус метки своего острова в пикселях. Остальные метки меньше, чтобы своя находилась взглядом сразу.",
        default: 5.4,
        min: 1.5,
        max: 12,
        step: 0.1,
      },
      unlockGlowSeconds: {
        type: "number",
        label: "Новая постройка: период подсветки",
        description: "Секунды одного удара золотой подсветки на плитке только что открывшейся постройки. Подсветка гаснет при наведении.",
        default: 1.5,
        min: 0.4,
        max: 6,
        step: 0.1,
      },
      panelAnimMs: {
        type: "int",
        label: "Панель построек: длительность",
        description: "Миллисекунды на появление и на исчезновение панели построек. 0 — без анимации.",
        default: 150,
        min: 0,
        max: 600,
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
        default: "Snow",
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
        default: "Meadow",
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
        default: "Ice",
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
        default: "Forest",
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
        default: "Wasteland",
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
      edgeBankEnabled: {
        type: "boolean",
        label: "Вал облаков по краю",
        description: "Сгущать облака на границе мира, чтобы у карты был горизонт, а не обрыв.",
        default: true,
      },
      edgeBankStart: {
        type: "number",
        label: "Вал: где начинается",
        description: "Доля радиуса Окраины, с которой облака начинают густеть. 1 — ровно на краю мира.",
        default: 0.86,
        min: 0.2,
        max: 1.4,
        step: 0.01,
      },
      edgeBankWidth: {
        type: "number",
        label: "Вал: ширина",
        description: "За сколько мировых единиц от начала вала облака становятся сплошными.",
        default: 2600,
        min: 100,
        max: 12000,
        step: 50,
      },
      edgeBankDensity: {
        type: "number",
        label: "Вал: плотность",
        description: "Насколько плотно затягивается край мира. 0 — вала нет.",
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
      },
    },
  },
  fog: {
    label: "Туман войны",
    description:
      "Три состояния клетки: не открыта (не рисуется совсем), открыта но не видна (память, приглушённая), видна. Видимость идёт от своей территории плюс радиус вокруг неё.",
    fields: {
      enabled: {
        type: "boolean",
        label: "Туман войны",
        description: "Выключает туман целиком: весь мир виден сразу.",
        default: true,
      },
      revealRadius: {
        type: "number",
        label: "Радиус обзора",
        description: "На сколько мировых единиц вокруг своей клетки открывается мир.",
        default: 1500,
        min: 100,
        max: 12000,
        step: 25,
      },
      softness: {
        type: "number",
        label: "Мягкость края",
        description: "Ширина растушёвки границы обзора в мировых единицах. Больше — плавнее переход.",
        default: 420,
        min: 0,
        max: 4000,
        step: 10,
      },
      exploredDim: {
        type: "number",
        label: "Яркость памяти",
        description: "Насколько ярко рисуется открытая, но не видимая сейчас земля. 1 — как живая.",
        default: 0.42,
        min: 0,
        max: 1,
        step: 0.01,
      },
      tintStrength: {
        type: "number",
        label: "Подмешивание тумана",
        description: "Насколько сильно приглушённая земля уводится в цвет тумана.",
        default: 0.72,
        min: 0,
        max: 1,
        step: 0.01,
      },
      fogColor: {
        type: "color",
        label: "Цвет тумана",
        description: "Тон, в который уходит открытая, но не видимая земля.",
        default: "#a9c3d8",
      },
      fadeSeconds: {
        type: "number",
        label: "Длительность проявления",
        description: "Сколько секунд занимает переход клетки между состояниями тумана.",
        default: 0.9,
        min: 0,
        max: 5,
        step: 0.05,
      },
      cloudDensity: {
        type: "number",
        label: "Плотность облаков над туманом",
        description: "Насколько сильно облачный слой затягивает неоткрытую часть мира. 0 — не затягивает.",
        default: 0.92,
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
      category: {
        type: "enum",
        label: "Раздел меню",
        description: "Вкладка панели построек, в которой здание показывается.",
        default: "core",
        options: BUILDING_CATEGORY_OPTIONS,
      },
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
        label: "Castle I",
        description: "The main building of the island. Costly and slow, but it takes a hit and collects the tax.",
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
          note: "The island centre: it unlocks buildings and holds the stores.",
        },
      },
      barracks1: {
        label: "Barracks I",
        description: "Trains units. It gives no resources, so it has no worker slots.",
        overrides: {
          category: "war",
          requires: "castle1",
          costWood: 260,
          costStone: 140,
          costGold: 60,
          buildTimeSec: 180,
          maxHp: 1400,
          workerSlots: 0,
          note: "Trains units, gives no resources.",
        },
      },
      hut1: {
        label: "Hut I",
        description: "The cheapest building. It gives workers a roof and mines nothing.",
        overrides: {
          costWood: 60,
          costStone: 20,
          buildTimeSec: 45,
          maxHp: 400,
          workerSlots: 3,
          terrain: "grass",
          note: "A home for three workers.",
        },
      },
      sawmill1: {
        label: "Sawmill I",
        description: "Cuts the forest around it, so it stands on a forest hex only.",
        overrides: {
          category: "economics",
          costWood: 120,
          costStone: 40,
          costGold: 10,
          buildTimeSec: 90,
          maxHp: 700,
          workerSlots: 3,
          productionResource: "wood",
          productionPerMin: 12,
          terrain: "forest",
          note: "The main source of wood.",
        },
      },
      mill1: {
        label: "Mill I",
        description: "Grinds grain from the meadow. It gives the food the units live on.",
        overrides: {
          category: "economics",
          costWood: 140,
          costStone: 60,
          costGold: 15,
          buildTimeSec: 110,
          maxHp: 700,
          workerSlots: 3,
          productionResource: "food",
          productionPerMin: 10,
          terrain: "grass",
          note: "The main source of food.",
        },
      },
      mine1: {
        label: "Mine I",
        description: "Breaks rock in the wasteland. It gives little stone, but walls do not grow without it.",
        overrides: {
          category: "economics",
          costWood: 100,
          costStone: 90,
          costGold: 25,
          buildTimeSec: 150,
          maxHp: 900,
          workerSlots: 4,
          productionResource: "stone",
          productionPerMin: 8,
          terrain: "sand",
          note: "The main source of stone.",
        },
      },
      islandController1: {
        label: "Island controller I",
        description: "Stands on the border and takes the neighbouring hexes for the player. It mines nothing itself.",
        overrides: {
          requires: "castle1",
          costWood: 200,
          costStone: 200,
          costGold: 150,
          buildTimeSec: 240,
          maxHp: 1500,
          workerSlots: 1,
          claimRadius: 2,
          note: "Widens the territory by two rings of hexes.",
        },
      },
    },
  },
  economy: {
    label: "Экономика",
    description:
      "Стартовый запас и обозы. Производство не капает в казну само: здание отправляет груз пешком до замка, и ресурс засчитывается на месте прибытия.",
    fields: {
      enabled: {
        type: "boolean",
        label: "Экономика включена",
        description: "Выключает списание цены, добычу и обозы целиком. Стройка становится бесплатной.",
        default: true,
      },
      startStockHeadroom: {
        type: "number",
        label: "Стартовый запас: множитель",
        description:
          "Во сколько раз стартовый запас больше суммы «замок плюс четыре самых дешёвых здания». 1 — впритык, без права на ошибку.",
        default: 1.35,
        min: 1,
        max: 4,
        step: 0.05,
      },
      startStockFloor: {
        type: "int",
        label: "Стартовый запас: минимум",
        description: "Нижняя граница стартового запаса каждого ресурса. Еду ни одно здание не стоит, поэтому её запас — ровно эта величина.",
        default: 50,
        min: 0,
        max: 5000,
      },
      parcelSpeed: {
        type: "number",
        label: "Обоз: скорость",
        description: "Сколько мировых единиц груз проходит за секунду. Шаг между центрами соседних гексов — от 66 до 102 единиц.",
        default: 170,
        min: 10,
        max: 1000,
        step: 5,
      },
      parcelSpacing: {
        type: "number",
        label: "Обоз: дистанция",
        description:
          "Минимальный промежуток между двумя грузами на общем участке пути, в мировых единицах вдоль дороги. Догнавший передний груз замедляется до этой дистанции.",
        default: 42,
        min: 4,
        max: 400,
        step: 1,
      },
      parcelCarry: {
        type: "int",
        label: "Обоз: вместимость",
        description: "Сколько единиц ресурса несёт один груз и сколько засчитывается замку по прибытии.",
        default: 2,
        min: 1,
        max: 100,
      },
      castleIntakeLanes: {
        type: "int",
        label: "Замок: полос приёмки",
        description:
          "Сколько дорог замок принимает одновременно — по одной на сторону гекса. Дороги растут не из замка, а из этих подходов, поэтому каждая полоса везёт свою очередь. 1 — прежнее поведение: весь остров сходится в одну колею.",
        default: 6,
        min: 1,
        max: 6,
      },
      mergeLookahead: {
        type: "number",
        label: "Обоз: выдержка на слиянии",
        description:
          "За сколько дистанций до слияния двух дорог грузы начинают уступать друг другу. Меньше — плотнее поток, но два груза могут прийти к развилке бок о бок.",
        default: 2.5,
        min: 0,
        max: 8,
        step: 0.1,
      },
      productionSpeedup: {
        type: "number",
        label: "Ускорение добычи",
        description: "Делитель паузы между грузами. «Добыча в минуту» — балансное число, а демо не может ждать пять секунд на бревно.",
        default: 4,
        min: 1,
        max: 200,
        step: 0.5,
      },
      stallStockpileCap: {
        type: "int",
        label: "Склад при простое",
        description:
          "Сколько грузов здание копит у себя, пока дороги до замка нет. Появился замок — склад уходит обозом. 0 — простой без накопления.",
        default: 12,
        min: 0,
        max: 100,
      },
    },
  },
  units: {
    label: "Отряды",
    description: "Кого готовит казарма и почём. Поля общие для всех отрядов.",
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
      armyCost: {
        type: "int",
        label: "Мест в армии",
        description: "Сколько мест предела армии занимает один отряд.",
        default: 1,
        min: 0,
        max: 10,
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
      tint: {
        type: "color",
        label: "Цвет накидки",
        description: "Тон плаща фигурки на карте. Пятно под ногами красится цветом игрока, а не этим.",
        default: "#cfd8e2",
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
      swordsman: {
        label: "Swordsman",
        description: "Cheap melee, holds the line.",
        overrides: {
          costFood: 40,
          costGold: 10,
          trainTimeSec: 25,
          maxHp: 220,
          damage: 18,
          attackSpeed: 1.1,
          tint: "#c8483f",
          note: "Holds the line.",
        },
      },
      archer: {
        label: "Archer",
        description: "Hits from afar, but dies in melee.",
        overrides: {
          costFood: 30,
          costWood: 20,
          trainTimeSec: 30,
          maxHp: 130,
          damage: 14,
          attackSpeed: 0.9,
          moveSpeed: 1.1,
          attackRangeHex: 3.5,
          tint: "#4f8f4a",
          note: "Shoots from behind the swordsmen.",
        },
      },
    },
  },
  army: {
    label: "Армия",
    description:
      "Предел армии и повадки готовых отрядов. Казарма предела не поднимает — она только готовит; места дают замок и хижины.",
    fields: {
      castleBaseCapacity: {
        type: "int",
        label: "Замок: мест в армии",
        description: "Сколько мест даёт один достроенный замок. Это вся база предела.",
        default: 10,
        min: 0,
        max: 200,
      },
      hutSlotsFeedArmy: {
        type: "boolean",
        label: "Хижины дают места",
        description:
          "Считать ли «рабочие места» хижины местами в армии. Поле «рабочие места» пока значит и жильцов, и солдат.",
        default: true,
      },
      queueLimit: {
        type: "int",
        label: "Очередь казармы",
        description: "Сколько заказов казарма держит в очереди. Дальше найм отказывает.",
        default: 6,
        min: 1,
        max: 20,
      },
      moveSpeedScale: {
        type: "number",
        label: "Ускорение шага",
        description: "Множитель «скорости шага» отряда. Балансные гексы в секунду демо не выдерживает.",
        default: 1.6,
        min: 0.1,
        max: 10,
        step: 0.1,
      },
      rallySpacing: {
        type: "number",
        label: "Разбег у точки сбора",
        description:
          "Расстояние между соседними отрядами на точке сбора, в мировых единицах. По вертикали оно сплющено вместе со всей картой, поэтому запас нужен больше, чем кажется.",
        default: 30,
        min: 6,
        max: 120,
        step: 1,
      },
      unitScale: {
        type: "number",
        label: "Размер фигурки",
        description: "Общий размер отряда на карте, доля от гекса.",
        default: 1,
        min: 0.3,
        max: 3,
        step: 0.05,
      },
      playerColor: {
        type: "color",
        label: "Цвет игрока",
        description: "Цвет пятна под своими отрядами — по нему они и опознаются на любой земле.",
        default: "#2f8bff",
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
        label: "Raider",
        description: "Placeholder. The ordinary footman of the camp.",
        overrides: {
          maxHp: 140,
          damage: 16,
          moveSpeed: 1.1,
          aggroRadiusHex: 3,
          rewardGold: 14,
          note: "A rank-and-file enemy.",
        },
      },
      wolf: {
        label: "Wolf",
        description: "Placeholder. Fast and fragile, moves in a pack.",
        overrides: {
          maxHp: 90,
          damage: 11,
          attackSpeed: 1.4,
          moveSpeed: 1.8,
          aggroRadiusHex: 4.5,
          rewardGold: 6,
          rewardFood: 8,
          note: "Catches the stragglers.",
        },
      },
      brute: {
        label: "Brute",
        description: "Placeholder. Slow, but hits very hard.",
        overrides: {
          maxHp: 420,
          damage: 34,
          attackSpeed: 0.6,
          moveSpeed: 0.7,
          aggroRadiusHex: 2.5,
          rewardGold: 40,
          note: "Breaks walls and formations.",
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
        label: "Raider camp",
        description: "Placeholder. The basic source of raiders.",
        overrides: {
          maxHp: 600,
          note: "A steady stream of raiders.",
        },
      },
      den: {
        label: "Wolf den",
        description: "Placeholder. It releases wolves in pairs, and often.",
        overrides: {
          maxHp: 380,
          spawnIntervalSec: 30,
          spawnUnit: "wolf",
          spawnBatch: 2,
          garrisonCap: 6,
          rewardGold: 45,
          note: "Frequent fast packs.",
        },
      },
      watchtower: {
        label: "Watchtower",
        description: "Placeholder. Rarely, but it releases brutes.",
        overrides: {
          maxHp: 1200,
          spawnIntervalSec: 90,
          spawnUnit: "brute",
          garrisonCap: 2,
          rewardGold: 120,
          note: "Rare but heavy guests.",
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
  BUILDING_CATEGORY_OPTIONS,
  DEFAULTS,
  RESOURCE_OPTIONS,
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
