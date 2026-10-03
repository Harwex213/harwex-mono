import { boxAt } from "./geometry";
import { paintShapes } from "./shape";
import type { ColorName } from "./palette";
import type { Rect, Size, UnitPoint } from "./geometry";
import type { ShapeNode } from "./shape";

// The sixteen biomes one map tile can carry. `forrest` and `polar_desert` keep
// the spelling the design doc uses.
type Biome =
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

type HexPlacement = {
  bounds: Rect;
  biome: Biome;
};

type HexManifest = {
  readonly id: "hex";
  readonly size: Size;
  readonly outline: readonly UnitPoint[];
  readonly biomes: readonly Biome[];
  readonly variants: Readonly<Record<Biome, readonly ShapeNode[]>>;
  draw(ctx: CanvasRenderingContext2D, placement: HexPlacement): void;
};

// A pointy-top hexagon. The six sides come out equal when the width is
// sqrt(3) / 2 of the height, which is what `size` holds.
const outline: readonly UnitPoint[] = [
  { x: 0.5, y: 0 },
  { x: 1, y: 0.25 },
  { x: 1, y: 0.75 },
  { x: 0.5, y: 1 },
  { x: 0, y: 0.75 },
  { x: 0, y: 0.25 },
];

const size: Size = {
  width: 104,
  height: 120,
};

const spike: readonly UnitPoint[] = [
  { x: 0.5, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const mound: readonly UnitPoint[] = [
  { x: 0, y: 1 },
  { x: 0.12, y: 0.45 },
  { x: 0.32, y: 0.12 },
  { x: 0.5, y: 0 },
  { x: 0.68, y: 0.12 },
  { x: 0.88, y: 0.45 },
  { x: 1, y: 1 },
];

const tuft: readonly UnitPoint[] = [
  { x: 0, y: 1 },
  { x: 0.05, y: 0.42 },
  { x: 0.12, y: 0.4 },
  { x: 0.2, y: 0.82 },
  { x: 0.42, y: 0.02 },
  { x: 0.5, y: 0.04 },
  { x: 0.56, y: 0.82 },
  { x: 0.82, y: 0.3 },
  { x: 0.9, y: 0.34 },
  { x: 1, y: 1 },
];

const dune: readonly UnitPoint[] = [
  { x: 0, y: 1 },
  { x: 0.3, y: 0.25 },
  { x: 0.62, y: 0 },
  { x: 1, y: 0.6 },
  { x: 1, y: 1 },
];

const shard: readonly UnitPoint[] = [
  { x: 0.5, y: 0 },
  { x: 1, y: 0.55 },
  { x: 0.72, y: 1 },
  { x: 0.2, y: 1 },
  { x: 0, y: 0.4 },
];

const mesa: readonly UnitPoint[] = [
  { x: 0.06, y: 1 },
  { x: 0.14, y: 0.34 },
  { x: 0.24, y: 0.16 },
  { x: 0.76, y: 0.16 },
  { x: 0.86, y: 0.34 },
  { x: 0.94, y: 1 },
];

const cone: readonly UnitPoint[] = [
  { x: 0.34, y: 0 },
  { x: 0.66, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const flow: readonly UnitPoint[] = [
  { x: 0.35, y: 0 },
  { x: 0.65, y: 0 },
  { x: 1, y: 1 },
  { x: 0.55, y: 1 },
];

const terrace: readonly UnitPoint[] = [
  { x: 0, y: 1 },
  { x: 0, y: 0.12 },
  { x: 0.46, y: 0.12 },
  { x: 0.46, y: 0.52 },
  { x: 0.82, y: 0.52 },
  { x: 0.82, y: 0.78 },
  { x: 1, y: 0.78 },
  { x: 1, y: 1 },
];

const ground = (fill: ColorName): ShapeNode => {
  return {
    shape: "polygon",
    points: outline,
    fill,
    stroke: "hexEdge",
    strokeWidth: 2,
  };
};

const conifer = (
  x: number,
  top: number,
  width: number,
  height: number,
  crown: ColorName,
): ShapeNode[] => {
  return [
    {
      shape: "rect",
      area: {
        x: x - width * 0.07,
        y: top + height,
        width: width * 0.14,
        height: height * 0.2,
      },
      fill: "bark",
    },
    {
      shape: "polygon",
      area: {
        x: x - width / 2,
        y: top,
        width,
        height,
      },
      points: spike,
      fill: crown,
    },
  ];
};

const broadleaf = (x: number, y: number, width: number, crown: ColorName): ShapeNode[] => {
  return [
    {
      shape: "rect",
      area: boxAt(x, y + width * 0.46, width * 0.11, width * 0.42),
      fill: "bark",
    },
    {
      shape: "ellipse",
      area: boxAt(x, y, width, width * 0.86),
      fill: crown,
    },
  ];
};

const palm = (x: number, y: number, width: number, crown: ColorName): ShapeNode[] => {
  const leaf = width * 0.66;

  return [
    {
      shape: "rect",
      area: boxAt(x, y + width * 0.44, width * 0.1, width * 0.74),
      fill: "bark",
    },
    {
      shape: "ellipse",
      area: boxAt(x - leaf * 0.36, y + width * 0.16, leaf, leaf * 0.28),
      turn: 0.06,
      fill: crown,
    },
    {
      shape: "ellipse",
      area: boxAt(x + leaf * 0.36, y + width * 0.16, leaf, leaf * 0.28),
      turn: -0.06,
      fill: crown,
    },
    {
      shape: "ellipse",
      area: boxAt(x - leaf * 0.28, y - width * 0.08, leaf * 0.8, leaf * 0.26),
      turn: -0.1,
      fill: crown,
    },
    {
      shape: "ellipse",
      area: boxAt(x + leaf * 0.28, y - width * 0.08, leaf * 0.8, leaf * 0.26),
      turn: 0.1,
      fill: crown,
    },
    {
      shape: "circle",
      area: boxAt(x, y - width * 0.04, width * 0.36, width * 0.36),
      fill: crown,
    },
  ];
};

const variants: Record<Biome, readonly ShapeNode[]> = {
  grassland: [
    ground("grassland"),
    { shape: "polygon", area: boxAt(0.32, 0.44, 0.2, 0.17), points: tuft, fill: "grasslandShade" },
    { shape: "polygon", area: boxAt(0.62, 0.56, 0.22, 0.18), points: tuft, fill: "grasslandShade" },
    { shape: "polygon", area: boxAt(0.4, 0.68, 0.18, 0.15), points: tuft, fill: "grasslandShade" },
  ],
  plains: [
    ground("plains"),
    { shape: "ellipse", area: boxAt(0.5, 0.4, 0.58, 0.07), fill: "plainsShade" },
    { shape: "ellipse", area: boxAt(0.5, 0.55, 0.72, 0.07), fill: "plainsShade" },
    { shape: "ellipse", area: boxAt(0.5, 0.7, 0.52, 0.07), fill: "plainsShade" },
  ],
  forrest: [
    ground("forrest"),
    ...broadleaf(0.3, 0.44, 0.26, "forrestShade"),
    ...broadleaf(0.66, 0.4, 0.22, "forrestShade"),
    ...broadleaf(0.48, 0.63, 0.28, "forrestShade"),
  ],
  savanna: [
    ground("savanna"),
    { shape: "polygon", area: boxAt(0.28, 0.58, 0.2, 0.15), points: tuft, fill: "savannaShade" },
    { shape: "polygon", area: boxAt(0.71, 0.67, 0.17, 0.13), points: tuft, fill: "savannaShade" },
    { shape: "rect", area: boxAt(0.52, 0.55, 0.035, 0.24), fill: "bark" },
    { shape: "ellipse", area: boxAt(0.52, 0.4, 0.36, 0.13), fill: "foliage" },
  ],
  rainforest: [
    ground("rainforest"),
    ...palm(0.34, 0.42, 0.26, "rainforestShade"),
    ...palm(0.68, 0.52, 0.22, "rainforestShade"),
  ],
  taiga: [
    ground("taiga"),
    ...conifer(0.3, 0.34, 0.2, 0.3, "taigaShade"),
    ...conifer(0.55, 0.42, 0.18, 0.26, "taigaShade"),
    ...conifer(0.74, 0.36, 0.16, 0.24, "taigaShade"),
  ],
  tundra: [
    ground("tundra"),
    { shape: "ellipse", area: boxAt(0.34, 0.44, 0.26, 0.12), fill: "tundraShade" },
    { shape: "ellipse", area: boxAt(0.62, 0.58, 0.3, 0.13), fill: "tundraShade" },
    { shape: "ellipse", area: boxAt(0.44, 0.67, 0.2, 0.09), fill: "snow" },
    { shape: "ellipse", area: boxAt(0.68, 0.38, 0.14, 0.07), fill: "snow" },
  ],
  desert: [
    ground("desert"),
    { shape: "polygon", area: { x: 0.08, y: 0.44, width: 0.5, height: 0.2 }, points: dune, fill: "desertShade" },
    { shape: "polygon", area: { x: 0.44, y: 0.55, width: 0.46, height: 0.17 }, points: dune, fill: "desertShade" },
  ],
  polar_desert: [
    ground("polarDesert"),
    { shape: "ellipse", area: boxAt(0.5, 0.68, 0.52, 0.07), fill: "polarDesertShade" },
    { shape: "polygon", area: boxAt(0.37, 0.46, 0.3, 0.24), points: shard, fill: "snow", stroke: "polarDesertShade", strokeWidth: 2 },
    { shape: "polygon", area: boxAt(0.64, 0.56, 0.24, 0.18), points: shard, fill: "ice", stroke: "polarDesertShade", strokeWidth: 2 },
  ],
  swamp: [
    ground("swamp"),
    { shape: "ellipse", area: boxAt(0.36, 0.5, 0.3, 0.16), fill: "water" },
    { shape: "ellipse", area: boxAt(0.64, 0.64, 0.26, 0.13), fill: "water" },
    { shape: "polygon", area: boxAt(0.62, 0.42, 0.18, 0.18), points: tuft, fill: "swampShade" },
    { shape: "polygon", area: boxAt(0.3, 0.67, 0.15, 0.14), points: tuft, fill: "swampShade" },
  ],
  badlands: [
    ground("badlands"),
    { shape: "ellipse", area: boxAt(0.66, 0.68, 0.36, 0.06), fill: "badlandsShade" },
    { shape: "polygon", area: { x: 0.16, y: 0.3, width: 0.5, height: 0.32 }, points: mesa, fill: "badlandsShade" },
    { shape: "rect", area: { x: 0.2, y: 0.42, width: 0.42, height: 0.03 }, fill: "badlands" },
    { shape: "rect", area: { x: 0.22, y: 0.52, width: 0.38, height: 0.03 }, fill: "badlands" },
  ],
  crater: [
    ground("crater"),
    { shape: "ellipse", area: boxAt(0.5, 0.52, 0.56, 0.3), fill: "craterShade" },
    { shape: "ellipse", area: boxAt(0.5, 0.52, 0.36, 0.18), fill: "ash" },
    { shape: "ellipse", area: boxAt(0.26, 0.68, 0.1, 0.05), fill: "craterShade" },
    { shape: "ellipse", area: boxAt(0.74, 0.36, 0.09, 0.045), fill: "craterShade" },
  ],
  volcano: [
    ground("volcanoShade"),
    { shape: "polygon", area: { x: 0.14, y: 0.28, width: 0.72, height: 0.46 }, points: cone, fill: "ash" },
    { shape: "polygon", area: { x: 0.44, y: 0.3, width: 0.16, height: 0.42 }, points: flow, fill: "volcano" },
    { shape: "ellipse", area: boxAt(0.5, 0.3, 0.26, 0.07), fill: "lava" },
  ],
  hills: [
    ground("hills"),
    { shape: "polygon", area: { x: 0.1, y: 0.42, width: 0.44, height: 0.26 }, points: mound, fill: "hillsShade" },
    { shape: "polygon", area: { x: 0.46, y: 0.48, width: 0.42, height: 0.22 }, points: mound, fill: "hillsShade" },
  ],
  mountains: [
    ground("mountains"),
    { shape: "polygon", area: { x: 0.12, y: 0.32, width: 0.46, height: 0.4 }, points: spike, fill: "mountainsShade" },
    { shape: "polygon", area: { x: 0.28, y: 0.32, width: 0.14, height: 0.12 }, points: spike, fill: "snow" },
    { shape: "polygon", area: { x: 0.46, y: 0.42, width: 0.42, height: 0.3 }, points: spike, fill: "mountainsShade" },
    { shape: "polygon", area: { x: 0.607, y: 0.42, width: 0.126, height: 0.09 }, points: spike, fill: "snow" },
  ],
  cliffs: [
    ground("cliffs"),
    { shape: "polygon", area: { x: 0.1, y: 0.28, width: 0.62, height: 0.36 }, points: terrace, fill: "cliffsShade" },
    { shape: "rect", area: { x: 0.1, y: 0.28, width: 0.285, height: 0.025 }, fill: "cliffs" },
    { shape: "rect", area: { x: 0.385, y: 0.465, width: 0.223, height: 0.025 }, fill: "cliffs" },
    { shape: "ellipse", area: boxAt(0.66, 0.63, 0.34, 0.07), fill: "water" },
    { shape: "ellipse", area: boxAt(0.5, 0.72, 0.5, 0.08), fill: "water" },
  ],
};

const biomes: readonly Biome[] = Object.keys(variants) as Biome[];

const Hex: HexManifest = {
  id: "hex",
  size,
  outline,
  biomes,
  variants,
  draw(ctx, placement) {
    paintShapes(ctx, variants[placement.biome], placement.bounds);
  },
};

export type { Biome, HexManifest, HexPlacement };
export { Hex };
