import { mapToScreen, screenToMap } from "./view";
import type { Bounds } from "./manifest";
import type { Point, Size, View } from "./view";

// PURE. The font ramp, the anchor fallback chain, the pole-of-inaccessibility
// search, the chamfer distance transform, the fit test and the greedy collision
// layout. No canvas, no DOM, no signals — every function here is a pure function
// of its arguments, so the whole module is unit testable in Node.
//
// Text widths arrive as NUMBERS. `measureText` lives in `src/ui/label-layer.ts`
// and nowhere else, which is what keeps the maths below testable.

// (countryId, mapX, mapY) -> is that map pixel inside that country? A callback,
// so this module never touches the province bitmap.
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
  // MUST already be sorted by `pixelCount` descending. `resolveLabelAnchor`
  // honours the given order and does not sort.
  provinces: readonly AnchorCandidate[];
  contains: ContainsFn;
  candidateLimit?: number;
  grid?: GridOptions;
};

// What the store hands the renderer. Everything in MAP pixels.
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
  // Screen CSS px. `x` is the LEFT edge of the first glyph, `y` the vertical
  // CENTRE of the line — the draw uses `textAlign "left"`, `textBaseline
  // "middle"`.
  x: number;
  y: number;
  fontSize: number;
  rect: LabelRect;
  // Which entry of NUDGE_OFFSETS won. 0 means the label sits on its anchor.
  offsetIndex: number;
  // False when the rect misses the viewport. Such a placement STILL holds its
  // slot; it is simply not drawn.
  visible: boolean;
};

type LayoutOptions = {
  candidates: readonly LabelCandidate[];
  // The SNAPPED view, the one `drawScene` uses.
  view: View;
  viewport: Size;
  contains?: ContainsFn;
  fitWidthRatio?: number;
  fitHeightRatio?: number;
  paddingX?: number;
  paddingY?: number;
};

// THE EXPONENT IS THE WHOLE POINT. The zoom range is 25x (0.317 fit to the 8x
// cap). A size linear in scale would give 13 px at fit and 328 px at the cap — a
// billboard. 0.45 gives 13 px at fit, 21.6 at 1:1, and hits the 34 px ceiling
// around 3x. `referenceScale` 0.32 is the fit scale of the 3653 x 2855 map in a
// roughly 1150 px wide viewport, which is the size the app opens at.
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

// x in units of the label's TEXT WIDTH, y in units of its FONT SIZE. Vertical
// first: on a political map a name shifted up or down still reads as belonging
// to the same country, while a horizontal shift drifts toward a neighbour.
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

// CSS pixels, like `BorderStyle.widthCss`. The canvas transform is already
// `setTransform(dpr, 0, 0, dpr, 0, 0)` when labels draw, so a CSS-px font size
// is correct on every display ratio with no extra arithmetic.
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

// Two-pass chamfer distance transform. `mask[i] !== 0` means "in the shape". The
// result is each in-shape cell's approximate distance to the nearest
// out-of-shape cell, in cell units. Out-of-grid neighbours count as
// out-of-shape, so a cell on the grid edge scores at most 1.
//
// The (1, sqrt 2) weights rather than plain Manhattan: Manhattan's iso-distance
// contours are diamonds, so it puts the label toward a diagonal tip of the
// shape. Diagonal sqrt 2 gives a near-circular contour, which is what "deepest
// interior point" should mean.
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

// A coarse grid, a distance transform, then refinement levels inside the winning
// cell's 3 x 3 neighbourhood. `levels * cells²` calls to `inside`, i.e. 1728 at
// the defaults — under a millisecond.
//
// `best` is returned even when a refinement level finds no hits, so a shape that
// thins out under refinement keeps the coarse answer instead of losing its
// label. The coarse answer was itself sampled through `inside`, so the "the
// point is in the shape" invariant holds either way.
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
    // Level 0 found nothing at all: the shape is thinner than the grid step. A
    // refinement level finding nothing means the previous winner stands.
    if (hits === 0) {
      return best;
    }

    const distance = chamferDistance(mask, cells, cells);
    let bestIndex = -1;
    let bestValue = -1;
    for (let i = 0; i < distance.length; i += 1) {
      // Strictly greater, so ties resolve to the LOWEST index. Deterministic.
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

// THE INVARIANT: every non-null return has been passed through `contains` and
// came back true. There is no branch that returns an unverified point. A "just
// use the bbox centre" fallback would break it and must not be added — that is
// exactly how a label ends up floating in the sea.
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

  // A province's own centre of mass lies inside that province for 1634 of the
  // 1648 shipped provinces, and a province of the country is by construction
  // inside the country. This step is what actually saves the crescent case.
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
  // The LARGEST PROVINCE's bbox, never the country's union bbox: a union box
  // reaches 3119 x 2427 map px, so a 24 x 24 grid samples every 130 px and
  // misses a thin arm entirely. A province box is at most 12 642 px of area.
  const inside: InsideFn = (x, y) => {
    return input.contains(input.countryId, x, y);
  };
  const pole = findInteriorPoint(input.provinces[0].bounds, inside, input.grid);
  if (pole === null) {
    return null;
  }
  return { point: pole, source: "pole" };
}

// Touching edges are NOT an overlap. Two labels flush against each other are
// legible; treating that as a collision drops a label for nothing.
function rectsOverlap(a: LabelRect, b: LabelRect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

// PAN INVARIANCE. The collision pass runs over EVERY candidate that passes the
// fit test, on-screen or not; `visible` decides only what gets drawn. Culling
// off-screen candidates first looks like an optimisation and is a bug: a label
// that scrolls out of view would free its slot, its neighbour would pop in, and
// scrolling back would pop it out again. Every pan would make labels jump.
function layoutLabels(options: LayoutOptions): LabelPlacement[] {
  const view = options.view;
  const viewport = options.viewport;
  const contains =
    options.contains ??
    (() => {
      return true;
    });
  const fitW = options.fitWidthRatio ?? FIT_WIDTH_RATIO;
  const fitH = options.fitHeightRatio ?? FIT_HEIGHT_RATIO;
  const padX = options.paddingX ?? LABEL_PADDING_X;
  const padY = options.paddingY ?? LABEL_PADDING_Y;

  if (!Number.isFinite(view.scale) || view.scale <= 0) {
    return [];
  }

  // Largest country wins. `countryId` ascending breaks a tie, so the output does
  // not depend on the order `countries` happens to be in.
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
    // The fit test, both dimensions, against the country's ON-SCREEN bounding
    // box. `textWidth` is measured, never estimated from a character count.
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

    let rect: LabelRect | null = null;
    let chosen = -1;
    let centreY = base.y;

    for (let i = 0; i < NUDGE_OFFSETS.length; i += 1) {
      const offset = NUDGE_OFFSETS[i];
      const cx = base.x + offset.x * candidate.textWidth;
      const cy = base.y + offset.y * candidate.fontSize;
      // Offset 0 IS the anchor, and `resolveLabelAnchor` already proved the
      // anchor is in-country. Re-testing it would cost a bitmap read per label
      // per frame for nothing. Every other offset MUST be tested, or a nudge
      // pushes the label into the sea.
      if (i > 0) {
        const back = screenToMap(view, cx, cy);
        if (!contains(candidate.countryId, back.x, back.y)) {
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
      rect = trial;
      chosen = i;
      centreY = cy;
      break;
    }

    // Every offset collided or left the country. The larger countries already
    // own this space; drop the label rather than draw it on top of one.
    if (rect === null) {
      continue;
    }

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
