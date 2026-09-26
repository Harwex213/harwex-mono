type BiomeId =
  | "grassland"
  | "plains"
  | "forrest"
  | "savanna"
  | "rainforest"
  | "taiga"
  | "tundra"
  | "desert"
  | "polar_desert"
  | "swamp"
  | "badlands"
  | "crater"
  | "volcano"
  | "hills"
  | "mountains"
  | "cliffs";

type Biome = {
  id: BiomeId;
  title: string;
};

const biomes: readonly Biome[] = [
  { id: "grassland", title: "умеренные луга" },
  { id: "plains", title: "равнина" },
  { id: "forrest", title: "лес" },
  { id: "savanna", title: "саванна" },
  { id: "rainforest", title: "джунгли" },
  { id: "taiga", title: "хвойный лес" },
  { id: "tundra", title: "тундра" },
  { id: "desert", title: "пустыня" },
  { id: "polar_desert", title: "ледяная пустыня" },
  { id: "swamp", title: "заболоченный биом" },
  { id: "badlands", title: "бесплодные земли" },
  { id: "crater", title: "кратер" },
  { id: "volcano", title: "вулкан" },
  { id: "hills", title: "холмы" },
  { id: "mountains", title: "горы" },
  { id: "cliffs", title: "утёсы" },
];

export { biomes };
export type { Biome, BiomeId };
