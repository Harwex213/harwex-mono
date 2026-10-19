import { mapToScreen, screenToMap } from "../view/view";
import type { Bounds } from "../data/manifest";
import type { Point, Size, View } from "../view/view";

// Pure country-label layout: font ramp, anchor search and greedy collision layout.
// Text widths arrive as numbers. The canvas layer measures text, so that this module stays testable in Node.

// Is the map pixel inside the country? A callback, so that this module never touches the province bitmap.
type ContainsFn = (countryId: number, mapX: number, mapY: number) => boolean;

// Bound to one country already. `findInteriorPoint` knows nothing about countries.
type InsideFn = (mapX: number, mapY: number) => boolean;

type LabelFontRamp = {
  referenceScale: number;
  basePx: number;
  exponent: number;
  minPx: number;
  maxPx: number;
};

type GridOptions = { cells?: number; levels?: number };

// One province, reduced to what the anchor search needs.
type AnchorCandidate = {
  x: number;
  y: number;
  pixelCount: number;
  bounds: Bounds;
};

type AnchorSource = "centroid" | "province" | "pole";
type LabelAnchor = { point: Point; source: AnchorSource };

type AnchorInput = {
  countryId: number;
  centroid: Point | null;
  // Sorted by `pixelCount` descending by the caller. `resolveLabelAnchor` does not sort.
  provinces: readonly AnchorCandidate[];
  contains: ContainsFn;
  candidateLimit?: number;
  grid?: GridOptions;
};

// Map pixels.
type CountryLabelSource = {
  countryId: number;
  text: string;
  anchor: Point;
  bounds: Bounds;
  area: number;
};

// A source plus the two numbers only the canvas layer can supply.
type LabelCandidate = CountryLabelSource & {
  textWidth: number;
  fontSize: number;
};

// Screen CSS px, top-left origin.
type LabelRect = { x: number; y: number; width: number; height: number };

type LabelPlacement = {
  countryId: number;
  text: string;
  // Screen CSS px. `x` is the left edge, `y` the vertical centre (`textAlign "left"`, `textBaseline "middle"`).
  x: number;
  y: number;
  fontSize: number;
  rect: LabelRect;
  // Which entry of NUDGE_OFFSETS won. 0 means the label sits on its anchor.
  offsetIndex: number;
  // False when the rect misses the viewport. The placement still holds its slot but is not drawn.
  visible: boolean;
};

type LayoutOptions = {
  candidates: readonly LabelCandidate[];
  // The snapped view that `drawScene` uses.
  view: View;
  viewport: Size;
  contains?: ContainsFn;
  // Opt-in end probe, see `chooseOffset`. Off by default, so that offset 0 costs no `contains` calls.
  probeEnds?: boolean;
  fitWidthRatio?: number;
  fitHeightRatio?: number;
  paddingX?: number;
  paddingY?: number;
};

// Font size grows as scale^0.45, so that a 25x zoom range does not turn labels into billboards.
// 13 px at fit, 21.6 px at 1:1, 34 px ceiling at about 3x.
// `referenceScale` 0.32 is the fit scale of the map in a ~1150 px wide viewport.
const LABEL_FONT_RAMP: LabelFontRamp = {
  referenceScale: 0.32,
  basePx: 13,
  exponent: 0.45,
  minPx: 9,
  maxPx: 34,
};

const ANCHOR_CANDIDATE_LIMIT = 8;
const GRID_CELLS = 24;
const GRID_LEVELS = 3;
// A 5% margin, so a label is not flush with the country's extremes.
const FIT_WIDTH_RATIO = 1.05;
// Roughly one line box plus leading.
const FIT_HEIGHT_RATIO = 1.6;
const LABEL_PADDING_X = 6;
const LABEL_PADDING_Y = 3;
// A degenerate transform must not produce absurd rects.
const COORD_LIMIT = 1e6;

// x in text widths, y in font sizes. Vertical shifts come first.
// A name shifted vertically still reads as its country's. A horizontal shift drifts toward a neighbour.
const NUDGE_OFFSETS: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 0, y: -1.25 },
  { x: 0, y: 1.25 },
  { x: -0.55, y: 0 },
  { x: 0.55, y: 0 },
  { x: 0, y: -2.5 },
  { x: 0, y: 2.5 },
];

const ORTHO = 1;
const DIAG = Math.SQRT2;

// CSS pixels. The canvas transform already applies dpr when labels draw.
function labelFontSize(scale: number, ramp: LabelFontRamp = LABEL_FONT_RAMP): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return ramp.minPx;
  }
  const raw = ramp.basePx * Math.pow(scale / ramp.referenceScale, ramp.exponent);
  if (!Number.isFinite(raw)) {
    return ramp.minPx;
  }
  return Math.min(ramp.maxPx, Math.max(ramp.minPx, raw));
}

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

// Two-pass chamfer distance to the nearest out-of-shape cell, in cell units.
// Decisions:
// - Out-of-grid cells count as out-of-shape, so a grid-edge cell scores at most 1.
// - Weights (1, sqrt 2), not Manhattan. Manhattan contours are diamonds and pull the label to a diagonal tip.
function chamferDistance(mask: Uint8Array, cols: number, rows: number): Float32Array {
  const distance = new Float32Array(Math.max(0, cols * rows));
  for (let i = 0; i < distance.length; i += 1) {
    distance[i] = mask[i] !== 0 ? Infinity : 0;
  }

  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      return 0;
    }
    return distance[y * cols + x];
  };

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const i = y * cols + x;
      if (distance[i] === 0) {
        continue;
      }
      const best = Math.min(
        at(x - 1, y) + ORTHO,
        at(x, y - 1) + ORTHO,
        at(x - 1, y - 1) + DIAG,
        at(x + 1, y - 1) + DIAG,
      );
      if (best < distance[i]) {
        distance[i] = best;
      }
    }
  }

  for (let y = rows - 1; y >= 0; y -= 1) {
    for (let x = cols - 1; x >= 0; x -= 1) {
      const i = y * cols + x;
      if (distance[i] === 0) {
        continue;
      }
      const best = Math.min(
        at(x + 1, y) + ORTHO,
        at(x, y + 1) + ORTHO,
        at(x + 1, y + 1) + DIAG,
        at(x - 1, y + 1) + DIAG,
      );
      if (best < distance[i]) {
        distance[i] = best;
      }
    }
  }

  return distance;
}

// Pole of inaccessibility: coarse grid, distance transform, then refinement in the winner's 3 x 3 cells.
// Costs `levels * cells²` calls to `inside` (1728 at the defaults).
// A refinement level with no hits keeps the previous winner, which `inside` has already confirmed.
function findInteriorPoint(
  bounds: Bounds,
  inside: InsideFn,
  options: GridOptions = {},
): Point | null {
  const cells = Math.max(3, Math.floor(options.cells ?? GRID_CELLS));
  const levels = Math.max(1, Math.floor(options.levels ?? GRID_LEVELS));
  if (!(bounds.width > 0) || !(bounds.height > 0)) {
    return null;
  }

  let box: Bounds = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
  let best: Point | null = null;

  for (let level = 0; level < levels; level += 1) {
    const stepX = box.width / cells;
    const stepY = box.height / cells;
    const mask = new Uint8Array(cells * cells);
    let hits = 0;
    for (let r = 0; r < cells; r += 1) {
      for (let c = 0; c < cells; c += 1) {
        const px = box.x + (c + 0.5) * stepX;
        const py = box.y + (r + 0.5) * stepY;
        if (inside(px, py)) {
          mask[r * cells + c] = 1;
          hits += 1;
        }
      }
    }
    // Level 0 with no hits: the shape is thinner than the grid step.
    if (hits === 0) {
      return best;
    }

    const distance = chamferDistance(mask, cells, cells);
    let bestIndex = -1;
    let bestValue = -1;
    for (let i = 0; i < distance.length; i += 1) {
      // Strictly greater, so that ties resolve to the lowest index.
      if (mask[i] !== 0 && distance[i] > bestValue) {
        bestValue = distance[i];
        bestIndex = i;
      }
    }
    if (bestIndex < 0) {
      return best;
    }

    const c = bestIndex % cells;
    const r = Math.floor(bestIndex / cells);
    best = { x: box.x + (c + 0.5) * stepX, y: box.y + (r + 0.5) * stepY };

    box = {
      x: box.x + (c - 1) * stepX,
      y: box.y + (r - 1) * stepY,
      width: stepX * 3,
      height: stepY * 3,
    };
  }

  return best;
}

// Invariant: every non-null result has passed `contains`.
// Do not add an unverified fallback such as the bbox centre. It puts labels in the sea.
function resolveLabelAnchor(input: AnchorInput): LabelAnchor | null {
  const limit = input.candidateLimit ?? ANCHOR_CANDIDATE_LIMIT;

  if (input.centroid !== null && isFinitePoint(input.centroid)) {
    if (input.contains(input.countryId, input.centroid.x, input.centroid.y)) {
      return {
        point: { x: input.centroid.x, y: input.centroid.y },
        source: "centroid",
      };
    }
  }

  // A province centroid is inside its province for 1634 of 1648 provinces. This step saves crescent-shaped countries.
  const tries = Math.min(limit, input.provinces.length);
  for (let i = 0; i < tries; i += 1) {
    const candidate = input.provinces[i];
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
      continue;
    }
    if (input.contains(input.countryId, candidate.x, candidate.y)) {
      return { point: { x: candidate.x, y: candidate.y }, source: "province" };
    }
  }

  if (input.provinces.length === 0) {
    return null;
  }
  // Search the largest province's bbox, not the country's union bbox.
  // A union bbox can span 3119 x 2427 px, and a 24 x 24 grid over it misses thin arms.
  const inside: InsideFn = (x, y) => {
    return input.contains(input.countryId, x, y);
  };
  const pole = findInteriorPoint(input.provinces[0].bounds, inside, input.grid);
  if (pole === null) {
    return null;
  }
  return { point: pole, source: "pole" };
}

// Touching edges are not an overlap. Flush labels stay legible.
function rectsOverlap(a: LabelRect, b: LabelRect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

// Tries the nudge offsets for one candidate. Returns `null` when every offset is rejected.
// End probe (`requireEndsInside`):
// - The fit test uses the union bbox, so a long thin country passes it and the label spills into a neighbour.
// - The probe requires both ends of the text span to be in-country. Padding may overhang.
// - The probe runs at offset 0 too, because offset 0 is the case that overhangs.
// - The probe depends only on scale, so that panning never changes the layout.
function chooseOffset(
  candidate: LabelCandidate,
  base: Point,
  boxW: number,
  boxH: number,
  view: View,
  contains: ContainsFn,
  placed: readonly LabelRect[],
  requireEndsInside: boolean,
): { rect: LabelRect; index: number; centreY: number } | null {
  for (let i = 0; i < NUDGE_OFFSETS.length; i += 1) {
    const offset = NUDGE_OFFSETS[i];
    const cx = base.x + offset.x * candidate.textWidth;
    const cy = base.y + offset.y * candidate.fontSize;
    // Offset 0 is the anchor, which `resolveLabelAnchor` has already verified. Other offsets need the test.
    if (i > 0) {
      const back = screenToMap(view, cx, cy);
      if (!contains(candidate.countryId, back.x, back.y)) {
        continue;
      }
    }
    if (requireEndsInside) {
      const half = candidate.textWidth / 2;
      const left = screenToMap(view, cx - half, cy);
      if (!contains(candidate.countryId, left.x, left.y)) {
        continue;
      }
      const right = screenToMap(view, cx + half, cy);
      if (!contains(candidate.countryId, right.x, right.y)) {
        continue;
      }
    }
    const trial: LabelRect = {
      x: cx - boxW / 2,
      y: cy - boxH / 2,
      width: boxW,
      height: boxH,
    };
    let hit = false;
    for (const other of placed) {
      if (rectsOverlap(trial, other)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      continue;
    }
    return { rect: trial, index: i, centreY: cy };
  }
  return null;
}

// Collisions run over every fitting candidate, on-screen or not. `visible` only decides drawing.
// Culling off-screen candidates first would free their slots and make labels jump on every pan.
function layoutLabels(options: LayoutOptions): LabelPlacement[] {
  const view = options.view;
  const viewport = options.viewport;
  const contains =
    options.contains ??
    (() => {
      return true;
    });
  const probeEnds = options.probeEnds ?? false;
  const fitW = options.fitWidthRatio ?? FIT_WIDTH_RATIO;
  const fitH = options.fitHeightRatio ?? FIT_HEIGHT_RATIO;
  const padX = options.paddingX ?? LABEL_PADDING_X;
  const padY = options.paddingY ?? LABEL_PADDING_Y;

  if (!Number.isFinite(view.scale) || view.scale <= 0) {
    return [];
  }

  // Largest country wins. Ties go to the lower `countryId`, so that input order does not matter.
  const sorted = options.candidates.slice().sort((a, b) => {
    return b.area - a.area || a.countryId - b.countryId;
  });

  const viewRect: LabelRect = {
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  };
  const placed: LabelRect[] = [];
  const out: LabelPlacement[] = [];

  for (const candidate of sorted) {
    if (candidate.text === "") {
      continue;
    }
    if (!(candidate.textWidth > 0) || !(candidate.fontSize > 0)) {
      continue;
    }
    // Fit test against the country's on-screen bbox, both dimensions.
    if (candidate.bounds.width * view.scale < candidate.textWidth * fitW) {
      continue;
    }
    if (candidate.bounds.height * view.scale < candidate.fontSize * fitH) {
      continue;
    }

    const base = mapToScreen(view, candidate.anchor.x, candidate.anchor.y);
    if (!Number.isFinite(base.x) || !Number.isFinite(base.y)) {
      continue;
    }
    if (Math.abs(base.x) > COORD_LIMIT || Math.abs(base.y) > COORD_LIMIT) {
      continue;
    }

    const boxW = candidate.textWidth + padX * 2;
    const boxH = candidate.fontSize + padY * 2;

    // End probe first, then the same trial without it.
    // The fallback means the probe changes only which offset wins, never whether a label is placed.
    const probed = probeEnds
      ? chooseOffset(candidate, base, boxW, boxH, view, contains, placed, true)
      : null;
    const trial =
      probed ?? chooseOffset(candidate, base, boxW, boxH, view, contains, placed, false);

    // Every offset collided or left the country. Drop the label.
    if (trial === null) {
      continue;
    }
    const rect = trial.rect;
    const chosen = trial.index;
    const centreY = trial.centreY;

    placed.push(rect);
    out.push({
      countryId: candidate.countryId,
      text: candidate.text,
      x: rect.x + padX,
      y: centreY,
      fontSize: candidate.fontSize,
      rect,
      offsetIndex: chosen,
      visible: rectsOverlap(rect, viewRect),
    });
  }

  return out;
}

export {
  ANCHOR_CANDIDATE_LIMIT,
  COORD_LIMIT,
  FIT_HEIGHT_RATIO,
  FIT_WIDTH_RATIO,
  GRID_CELLS,
  GRID_LEVELS,
  LABEL_FONT_RAMP,
  LABEL_PADDING_X,
  LABEL_PADDING_Y,
  NUDGE_OFFSETS,
  chamferDistance,
  findInteriorPoint,
  labelFontSize,
  layoutLabels,
  rectsOverlap,
  resolveLabelAnchor,
  type AnchorCandidate,
  type AnchorInput,
  type AnchorSource,
  type ContainsFn,
  type CountryLabelSource,
  type GridOptions,
  type InsideFn,
  type LabelAnchor,
  type LabelCandidate,
  type LabelFontRamp,
  type LabelPlacement,
  type LabelRect,
  type LayoutOptions,
};
