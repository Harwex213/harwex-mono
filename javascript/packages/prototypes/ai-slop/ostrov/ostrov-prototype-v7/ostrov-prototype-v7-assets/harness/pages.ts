import { Hex, ResourceIcon } from "../exports";
import type { Biome, ResourceKind } from "../exports";
import type { Rect, Size } from "../src/geometry";

// One preview per variant, state or style the manifest declares.
type Preview = {
  id: string;
  title: string;
  size: Size;
  draw(ctx: CanvasRenderingContext2D, frame: Rect): void;
};

type AssetPage = {
  id: string;
  title: string;
  previews: Preview[];
};

const biomeNames: Record<Biome, string> = {
  grassland: "умеренные луга",
  plains: "равнина",
  forrest: "лес",
  savanna: "саванна",
  rainforest: "джунгли",
  taiga: "хвойный лес",
  tundra: "тундра",
  desert: "пустыня",
  polar_desert: "ледяная пустыня",
  swamp: "заболоченный биом",
  badlands: "бесплодные земли",
  crater: "кратер",
  volcano: "вулкан",
  hills: "холмы",
  mountains: "горы",
  cliffs: "утёсы",
};

const resourceNames: Record<ResourceKind, string> = {
  food: "Еда",
  stone: "Камень",
  wood: "Дерево",
  population: "Население",
  hammers: "Молотки",
  science: "Наука",
  scouting: "Разведка",
  mana: "Мана",
  toxicity: "Токсичность",
  insane: "Сумасшедшие",
};

const hexPage = (): AssetPage => {
  return {
    id: "hex",
    title: "Hex",
    previews: Hex.biomes.map((biome) => {
      return {
        id: biome,
        title: `${biome} · ${biomeNames[biome]}`,
        size: Hex.size,
        draw(ctx, frame) {
          Hex.draw(ctx, {
            bounds: frame,
            biome,
          });
        },
      };
    }),
  };
};

const resourceIconPage = (): AssetPage => {
  return {
    id: "resource-icon",
    title: "Resource icon",
    previews: ResourceIcon.order.map((kind) => {
      return {
        id: kind,
        title: `${kind} · ${resourceNames[kind]}`,
        size: ResourceIcon.size,
        draw(ctx, frame) {
          ResourceIcon.draw(ctx, {
            bounds: frame,
            kind,
          });
        },
      };
    }),
  };
};

const pages = (): AssetPage[] => {
  return [hexPage(), resourceIconPage()];
};

export type { AssetPage, Preview };
export { pages };
