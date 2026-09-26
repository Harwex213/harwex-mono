import type { TBiome, TBiomeId } from "./types";

/**
 * The 16 biomes of the spec. The description is what the hex modal shows: it
 * says what the hex is like, and the modal derives the building hint from the
 * yield tables in `buildings.ts` rather than repeating it here.
 */

const BIOMES: readonly TBiome[] = [
  {
    id: "grassland",
    label: "Умеренные луга",
    description: "Жирная трава по пояс и ровная почва. Здесь растёт всё, и людям тут хорошо живётся.",
    color: "#6fae4f",
    edgeColor: "#3f6b2c",
  },
  {
    id: "plains",
    label: "Равнина",
    description: "Сухая ровная степь. Родит скупо, зато на ней легко строить что угодно.",
    color: "#a8bd5e",
    edgeColor: "#6d7a35",
  },
  {
    id: "forrest",
    label: "Лес",
    description: "Прямые стволы в два обхвата. Главный источник дерева на острове.",
    color: "#3f7d43",
    edgeColor: "#24512a",
  },
  {
    id: "savanna",
    label: "Саванна",
    description: "Редкие зонтичные деревья на выжженной траве. Дерева мало, но оно рядом.",
    color: "#c2a24c",
    edgeColor: "#83682a",
  },
  {
    id: "rainforest",
    label: "Джунгли",
    description: "Душная зелёная стена. Дерева больше, чем где бы то ни было, и гниёт оно так же быстро.",
    color: "#2f7d5c",
    edgeColor: "#18503a",
  },
  {
    id: "taiga",
    label: "Хвойный лес",
    description: "Смолистые ели на вечной мерзлоте. Ровный, надёжный лесоповал.",
    color: "#356b55",
    edgeColor: "#1d4436",
  },
  {
    id: "tundra",
    label: "Тундра",
    description: "Мох, лишайник и ветер. Людям тут тяжело, но жить можно.",
    color: "#8fa79b",
    edgeColor: "#5c6f66",
  },
  {
    id: "desert",
    label: "Пустыня",
    description: "Песок и камень до горизонта. Еды нет, зато никто не мешает.",
    color: "#dcc179",
    edgeColor: "#a08a4a",
  },
  {
    id: "polar_desert",
    label: "Ледяная пустыня",
    description: "Голый лёд. Тут выживают только упрямые.",
    color: "#c9dbe4",
    edgeColor: "#8ea6b2",
  },
  {
    id: "swamp",
    label: "Болото",
    description: "Тёплая жижа, мошка и пузыри газа. Отдаёт много и травит сильнее всего.",
    color: "#5c6b3a",
    edgeColor: "#38421f",
  },
  {
    id: "badlands",
    label: "Бесплодные земли",
    description: "Растрескавшаяся отравленная глина. Селиться тут — плохая идея.",
    color: "#a2603f",
    edgeColor: "#6b3a23",
  },
  {
    id: "crater",
    label: "Кратер",
    description: "Воронка от чего-то очень старого. По краям обнажилась порода.",
    color: "#7a6f66",
    edgeColor: "#4b433d",
  },
  {
    id: "volcano",
    label: "Вулкан",
    description: "Дышит серой и даёт больше камня, чем любая гора. И травит соразмерно.",
    color: "#6b3733",
    edgeColor: "#41201d",
  },
  {
    id: "hills",
    label: "Холмы",
    description: "Пологие склоны с хорошей землёй в распадках.",
    color: "#8a9a4e",
    edgeColor: "#5a672f",
  },
  {
    id: "mountains",
    label: "Горы",
    description: "Серый камень и снег на макушках. Лучшая порода на острове.",
    color: "#8d8f96",
    edgeColor: "#585b62",
  },
  {
    id: "cliffs",
    label: "Утёсы",
    description: "Обрыв по краю острова. Камень рядом, места мало.",
    color: "#7e8894",
    edgeColor: "#4e565f",
  },
];

const BIOME_BY_ID = new Map(BIOMES.map((biome) => [biome.id, biome]));

const getBiome = (id: TBiomeId) => {
  const biome = BIOME_BY_ID.get(id);
  if (!biome) {
    throw new Error(`Unknown biome: ${id}`);
  }

  return biome;
};

export { BIOMES, getBiome };
