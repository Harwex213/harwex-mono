import type { TBiomeId, TBiomeInfo } from "./types";

/**
 * The sixteen hex biomes of spec node-43, with a two-stop gradient and a glyph
 * for the procedurally drawn swatch (plan §4.4) and a hint at the building that
 * pays best on that biome, derived from the yield tables in `buildings.ts`.
 */

const BIOME_ORDER: readonly TBiomeId[] = [
  "grassland",
  "plains",
  "forrest",
  "savanna",
  "rainforest",
  "taiga",
  "tundra",
  "desert",
  "polar_desert",
  "swamp",
  "badlands",
  "crater",
  "volcano",
  "hills",
  "mountains",
  "cliffs",
];

const BIOMES: Readonly<Record<TBiomeId, TBiomeInfo>> = {
  grassland: {
    id: "grassland",
    nameRu: "Умеренные луга",
    descriptionRu: "Сочная трава и мягкая земля. Ферма даёт здесь 4 еды, деревня и любая гильдия — по 3. Лучший стартовый гекс.",
    colours: ["#8fc94a", "#4f7d22"],
    glyph: "ψ",
  },
  plains: {
    id: "plains",
    nameRu: "Равнина",
    descriptionRu: "Ровное и небогатое место. Всё строится и всё даёт по 2, зато токсичность почти не растёт.",
    colours: ["#cfd97a", "#8a9440"],
    glyph: "≡",
  },
  forrest: {
    id: "forrest",
    nameRu: "Лес",
    descriptionRu: "Ровный строевой лес. Лесопилка берёт отсюда 5 дерева всего за 1 токсичности.",
    colours: ["#4e9a4e", "#1f4a24"],
    glyph: "♣",
  },
  savanna: {
    id: "savanna",
    nameRu: "Саванна",
    descriptionRu: "Редкие деревья на сухой траве. Лесопилка даёт 2 дерева и совсем не пачкает гекс.",
    colours: ["#d9c06a", "#8a6f2e"],
    glyph: "ϒ",
  },
  rainforest: {
    id: "rainforest",
    nameRu: "Джунгли",
    descriptionRu: "Самый щедрый лес: лесопилка даёт 8 дерева, но добавляет 4 токсичности за ход.",
    colours: ["#3fbf7a", "#0f5a35"],
    glyph: "❁",
  },
  taiga: {
    id: "taiga",
    nameRu: "Хвойный лес",
    descriptionRu: "Холодный ельник. Лесопилка даёт 5 дерева при 2 токсичности.",
    colours: ["#5f8f7a", "#1e3c33"],
    glyph: "♠",
  },
  tundra: {
    id: "tundra",
    nameRu: "Тундра",
    descriptionRu: "Мёрзлая земля. Ферма собирает 2 еды без грязи, деревня и гильдии — по 2 при 2 токсичности.",
    colours: ["#b9c9bf", "#6e8478"],
    glyph: "❄",
  },
  desert: {
    id: "desert",
    nameRu: "Пустыня",
    descriptionRu: "Песок и зной. Ферму ставить некуда, остаётся деревня или гильдия на 1 единицу при 2 токсичности.",
    colours: ["#f0d79a", "#c39a4e"],
    glyph: "☀",
  },
  polar_desert: {
    id: "polar_desert",
    nameRu: "Ледяная пустыня",
    descriptionRu: "Голый лёд. Только деревня или гильдия, 1 единица за 3 токсичности. Строить в последнюю очередь.",
    colours: ["#f2f7fb", "#b9cbdb"],
    glyph: "✳",
  },
  swamp: {
    id: "swamp",
    nameRu: "Заболоченный биом",
    descriptionRu: "Жирный ил. Ферма даёт рекордные 5 еды, но 3 токсичности за ход: гекс сгорит за 34 хода.",
    colours: ["#8aa05a", "#39472a"],
    glyph: "≈",
  },
  badlands: {
    id: "badlands",
    nameRu: "Бесплодные земли",
    descriptionRu: "Мёртвая глина. Что ни поставь — 1 единица за 4 токсичности. Худший гекс острова.",
    colours: ["#c98f63", "#7a4a2c"],
    glyph: "✖",
  },
  crater: {
    id: "crater",
    nameRu: "Кратер",
    descriptionRu: "Выбитая порода на поверхности. Рудник берёт 3 камня всего за 1 токсичности.",
    colours: ["#a8a29a", "#5b544c"],
    glyph: "◎",
  },
  volcano: {
    id: "volcano",
    nameRu: "Вулкан",
    descriptionRu: "Лучший камень в игре: рудник даёт 10 камня, но добавляет 5 токсичности за ход.",
    colours: ["#a83224", "#3a0f0a"],
    glyph: "♨",
  },
  hills: {
    id: "hills",
    nameRu: "Холмы",
    descriptionRu: "Тёплые склоны. Единственное применение — ферма на 3 еды при 1 токсичности.",
    colours: ["#a8c06a", "#6a7a3a"],
    glyph: "⌒",
  },
  mountains: {
    id: "mountains",
    nameRu: "Горы",
    descriptionRu: "Основной источник камня: рудник даёт 7 камня при 3 токсичности.",
    colours: ["#c6c9cf", "#6b7078"],
    glyph: "▲",
  },
  cliffs: {
    id: "cliffs",
    nameRu: "Утёсы",
    descriptionRu: "Чистый камень. Рудник даёт 4 камня, а деревня и любая гильдия работают здесь совсем без токсичности.",
    colours: ["#b0a89c", "#5c554c"],
    glyph: "◺",
  },
};

export { BIOMES, BIOME_ORDER };
