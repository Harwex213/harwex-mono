import { boxAt, mirrorX } from "./geometry";
import { paintShapes } from "./shape";
import type { Rect, Size, UnitPoint } from "./geometry";
import type { ShapeNode } from "./shape";

// The ten counters the resource bar prints, in the order it prints them.
type ResourceKind =
  | "food"
  | "stone"
  | "wood"
  | "population"
  | "hammers"
  | "science"
  | "scouting"
  | "mana"
  | "toxicity"
  | "insane";

type ResourceIconPlacement = {
  bounds: Rect;
  kind: ResourceKind;
};

type ResourceIconManifest = {
  readonly id: "resource-icon";
  readonly size: Size;
  readonly order: readonly ResourceKind[];
  readonly kinds: Readonly<Record<ResourceKind, readonly ShapeNode[]>>;
  draw(ctx: CanvasRenderingContext2D, placement: ResourceIconPlacement): void;
};

const size: Size = {
  width: 40,
  height: 40,
};

const bone: readonly UnitPoint[] = [
  { x: 0.75, y: 0 },
  { x: 1, y: 0.22 },
  { x: 0.25, y: 1 },
  { x: 0, y: 0.78 },
];

const rockBody: readonly UnitPoint[] = [
  { x: 0.08, y: 0.72 },
  { x: 0.22, y: 0.3 },
  { x: 0.48, y: 0.12 },
  { x: 0.78, y: 0.22 },
  { x: 0.95, y: 0.56 },
  { x: 0.86, y: 0.88 },
  { x: 0.3, y: 0.92 },
];

const rockFacet: readonly UnitPoint[] = [
  { x: 0.3, y: 0.34 },
  { x: 0.5, y: 0.2 },
  { x: 0.72, y: 0.3 },
  { x: 0.56, y: 0.52 },
];

const rockShadow: readonly UnitPoint[] = [
  { x: 0.25, y: 0.78 },
  { x: 0.9, y: 0.6 },
  { x: 0.86, y: 0.88 },
  { x: 0.34, y: 0.9 },
];

const torso: readonly UnitPoint[] = [
  { x: 0.5, y: 0 },
  { x: 0.82, y: 0.14 },
  { x: 1, y: 0.62 },
  { x: 0.82, y: 0.68 },
  { x: 0.7, y: 0.4 },
  { x: 0.7, y: 1 },
  { x: 0.3, y: 1 },
  { x: 0.3, y: 0.4 },
  { x: 0.18, y: 0.68 },
  { x: 0, y: 0.62 },
  { x: 0.18, y: 0.14 },
];

const hammerHandle: readonly UnitPoint[] = [
  { x: 0.153, y: 0.913 },
  { x: 0.247, y: 0.987 },
  { x: 0.747, y: 0.337 },
  { x: 0.653, y: 0.263 },
];

const hammerHead: readonly UnitPoint[] = [
  { x: 0.583, y: 0.192 },
  { x: 0.668, y: 0.081 },
  { x: 0.937, y: 0.288 },
  { x: 0.852, y: 0.399 },
];

const bookCover: readonly UnitPoint[] = [
  { x: 0.04, y: 0.3 },
  { x: 0.5, y: 0.2 },
  { x: 0.96, y: 0.3 },
  { x: 0.96, y: 0.86 },
  { x: 0.5, y: 0.78 },
  { x: 0.04, y: 0.86 },
];

const pageLeft: readonly UnitPoint[] = [
  { x: 0.1, y: 0.34 },
  { x: 0.47, y: 0.26 },
  { x: 0.47, y: 0.74 },
  { x: 0.1, y: 0.8 },
];

const pageRight: readonly UnitPoint[] = [
  { x: 0.53, y: 0.26 },
  { x: 0.9, y: 0.34 },
  { x: 0.9, y: 0.8 },
  { x: 0.53, y: 0.74 },
];

const tube: readonly UnitPoint[] = [
  { x: 0.271, y: 0.58 },
  { x: 0.329, y: 0.661 },
  { x: 0.933, y: 0.273 },
  { x: 0.827, y: 0.127 },
];

const legLeft: readonly UnitPoint[] = [
  { x: 0.5, y: 0.44 },
  { x: 0.57, y: 0.49 },
  { x: 0.44, y: 0.96 },
  { x: 0.35, y: 0.96 },
];

const legRight: readonly UnitPoint[] = [
  { x: 0.53, y: 0.44 },
  { x: 0.6, y: 0.49 },
  { x: 0.74, y: 0.96 },
  { x: 0.65, y: 0.96 },
];

const legBack: readonly UnitPoint[] = [
  { x: 0.5, y: 0.46 },
  { x: 0.58, y: 0.5 },
  { x: 0.58, y: 0.92 },
  { x: 0.5, y: 0.92 },
];

const gem: readonly UnitPoint[] = [
  { x: 0.5, y: 0.06 },
  { x: 0.94, y: 0.5 },
  { x: 0.5, y: 0.94 },
  { x: 0.06, y: 0.5 },
];

const gemLit: readonly UnitPoint[] = [
  { x: 0.5, y: 0.06 },
  { x: 0.5, y: 0.5 },
  { x: 0.06, y: 0.5 },
];

const gemShade: readonly UnitPoint[] = [
  { x: 0.5, y: 0.5 },
  { x: 0.94, y: 0.5 },
  { x: 0.5, y: 0.94 },
];

const gemCore: readonly UnitPoint[] = [
  { x: 0.5, y: 0.3 },
  { x: 0.7, y: 0.5 },
  { x: 0.5, y: 0.7 },
  { x: 0.3, y: 0.5 },
];

const kinds: Record<ResourceKind, readonly ShapeNode[]> = {
  food: [
    { shape: "ellipse", area: boxAt(0.62, 0.36, 0.6, 0.52), fill: "meat" },
    { shape: "ellipse", area: boxAt(0.68, 0.28, 0.28, 0.18), fill: "meatLight" },
    { shape: "polygon", area: { x: 0.1, y: 0.48, width: 0.44, height: 0.38 }, points: bone, fill: "parchment" },
    { shape: "circle", area: boxAt(0.17, 0.8, 0.22, 0.22), fill: "parchment" },
    { shape: "circle", area: boxAt(0.31, 0.88, 0.18, 0.18), fill: "parchment" },
  ],
  stone: [
    { shape: "polygon", points: rockBody, fill: "rock" },
    { shape: "polygon", points: rockFacet, fill: "rockLight" },
    { shape: "polygon", points: rockShadow, fill: "rockShade" },
  ],
  wood: [
    { shape: "rect", area: { x: 0.2, y: 0.18, width: 0.68, height: 0.3 }, radius: 5, fill: "bark" },
    { shape: "ellipse", area: boxAt(0.24, 0.33, 0.22, 0.3), fill: "timber" },
    { shape: "ellipse", area: boxAt(0.24, 0.33, 0.11, 0.15), stroke: "bark", strokeWidth: 2 },
    { shape: "rect", area: { x: 0.12, y: 0.54, width: 0.72, height: 0.3 }, radius: 5, fill: "bark" },
    { shape: "ellipse", area: boxAt(0.16, 0.69, 0.22, 0.3), fill: "timber" },
    { shape: "ellipse", area: boxAt(0.16, 0.69, 0.11, 0.15), stroke: "bark", strokeWidth: 2 },
  ],
  population: [
    { shape: "circle", area: boxAt(0.5, 0.2, 0.32, 0.32), fill: "skin" },
    { shape: "polygon", area: { x: 0.16, y: 0.38, width: 0.68, height: 0.58 }, points: torso, fill: "cloth" },
    { shape: "rect", area: { x: 0.46, y: 0.7, width: 0.06, height: 0.26 }, fill: "clothShade" },
  ],
  hammers: [
    { shape: "polygon", points: mirrorX(hammerHandle), fill: "handle" },
    { shape: "polygon", points: mirrorX(hammerHead), fill: "steelPlate" },
    { shape: "polygon", points: hammerHandle, fill: "handle" },
    { shape: "polygon", points: hammerHead, fill: "steelPlate" },
  ],
  science: [
    { shape: "polygon", points: bookCover, fill: "cover" },
    { shape: "polygon", points: pageLeft, fill: "parchment" },
    { shape: "polygon", points: pageRight, fill: "parchment" },
    { shape: "rect", area: { x: 0.16, y: 0.42, width: 0.26, height: 0.04 }, fill: "muted" },
    { shape: "rect", area: { x: 0.16, y: 0.54, width: 0.22, height: 0.04 }, fill: "muted" },
    { shape: "rect", area: { x: 0.58, y: 0.44, width: 0.26, height: 0.04 }, fill: "muted" },
    { shape: "rect", area: { x: 0.58, y: 0.56, width: 0.22, height: 0.04 }, fill: "muted" },
  ],
  scouting: [
    { shape: "polygon", points: legBack, fill: "scope" },
    { shape: "polygon", points: legLeft, fill: "scope" },
    { shape: "polygon", points: legRight, fill: "scope" },
    { shape: "polygon", points: tube, fill: "steelPlate" },
    { shape: "circle", area: boxAt(0.88, 0.2, 0.2, 0.2), fill: "manaLight" },
    { shape: "circle", area: boxAt(0.29, 0.62, 0.12, 0.12), fill: "scope" },
  ],
  mana: [
    { shape: "polygon", points: gem, fill: "mana" },
    { shape: "polygon", points: gemLit, fill: "manaLight" },
    { shape: "polygon", points: gemShade, fill: "manaShade" },
    { shape: "polygon", points: gemCore, fill: "manaLight" },
  ],
  toxicity: [
    { shape: "circle", inset: 1, fill: "toxic" },
    { shape: "circle", area: boxAt(0.5, 0.3, 0.42, 0.42), stroke: "toxicShade", strokeWidth: 5 },
    { shape: "circle", area: boxAt(0.28, 0.66, 0.42, 0.42), stroke: "toxicShade", strokeWidth: 5 },
    { shape: "circle", area: boxAt(0.72, 0.66, 0.42, 0.42), stroke: "toxicShade", strokeWidth: 5 },
    { shape: "circle", area: boxAt(0.5, 0.54, 0.24, 0.24), fill: "toxic", stroke: "toxicShade", strokeWidth: 3 },
  ],
  insane: [
    { shape: "rect", area: { x: 0.46, y: 0.06, width: 0.08, height: 0.16 }, fill: "metalShade" },
    { shape: "circle", area: boxAt(0.5, 0.07, 0.16, 0.16), fill: "alarm" },
    { shape: "rect", area: { x: 0.1, y: 0.2, width: 0.8, height: 0.62 }, radius: 8, fill: "metal" },
    { shape: "rect", area: { x: 0.18, y: 0.31, width: 0.64, height: 0.26 }, radius: 5, fill: "night" },
    { shape: "circle", area: boxAt(0.33, 0.44, 0.15, 0.15), fill: "alarm" },
    { shape: "circle", area: boxAt(0.67, 0.44, 0.15, 0.15), fill: "alarm" },
    { shape: "rect", area: { x: 0.28, y: 0.64, width: 0.44, height: 0.1 }, radius: 3, fill: "metalShade" },
  ],
};

const order: readonly ResourceKind[] = Object.keys(kinds) as ResourceKind[];

const ResourceIcon: ResourceIconManifest = {
  id: "resource-icon",
  size,
  order,
  kinds,
  draw(ctx, placement) {
    paintShapes(ctx, kinds[placement.kind], placement.bounds);
  },
};

export type { ResourceIconManifest, ResourceIconPlacement, ResourceKind };
export { ResourceIcon };
