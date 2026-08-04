import assert from "node:assert/strict";
import test from "node:test";
import {
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
  resolveLabelAnchor,
} from "./label-layout";
import { MAX_SCALE, fitScale } from "./view";
import type { AnchorCandidate, ContainsFn, LabelCandidate } from "./label-layout";
import type { Bounds } from "./manifest";
import type { Point, Size, View } from "./view";

// T07 regression tests. `label-layout.test.ts` covers the happy paths and the
// headline invariants; this file covers the boundaries around them — the
// constants themselves, the option overrides, the guards, and the degenerate
// inputs that must not throw. Pure logic only, no canvas, no DOM.

const VIEWPORT: Size = { width: 1200, height: 800 };

// PLAN section 2: `provinces_map.png` is 3653 x 2855 and is the authoritative
// map size.
const MAP: Size = { width: 3653, height: 2855 };

function box(x: number, y: number, width: number, height: number): Bounds {
  return { x, y, width, height };
}

function candidate(patch: Partial<LabelCandidate>): LabelCandidate {
  return {
    countryId: 1,
    text: "ALPHA",
    anchor: { x: 100, y: 100 },
    bounds: box(0, 0, 4000, 4000),
    area: 1000,
    textWidth: 100,
    fontSize: 20,
    ...patch,
  };
}

function province(patch: Partial<AnchorCandidate>): AnchorCandidate {
  return {
    x: 0,
    y: 0,
    pixelCount: 100,
    bounds: box(0, 0, 60, 60),
    ...patch,
  };
}

function view(scale: number, x: number, y: number): View {
  return { scale, x, y };
}

// --- the constants themselves ---------------------------------------------

test("the tuning constants hold the values the whole task was sized around", () => {
  // Every one of these is quoted in DESIGN.md and the sums below depend on
  // them. A silent edit here changes what gets hidden and what collides.
  assert.equal(ANCHOR_CANDIDATE_LIMIT, 8);
  assert.equal(GRID_CELLS, 24);
  assert.equal(GRID_LEVELS, 3);
  assert.equal(FIT_WIDTH_RATIO, 1.05);
  assert.equal(FIT_HEIGHT_RATIO, 1.6);
  assert.equal(LABEL_PADDING_X, 6);
  assert.equal(LABEL_PADDING_Y, 3);
  assert.equal(COORD_LIMIT, 1e6);
  assert.deepEqual(LABEL_FONT_RAMP, {
    referenceScale: 0.32,
    basePx: 13,
    exponent: 0.45,
    minPx: 9,
    maxPx: 34,
  });
});

test("NUDGE_OFFSETS starts on the anchor, is distinct, and tries vertical first", () => {
  assert.deepEqual(NUDGE_OFFSETS[0], { x: 0, y: 0 }, "offset 0 IS the anchor");

  const keys = NUDGE_OFFSETS.map((offset) => {
    return offset.x + ":" + offset.y;
  });
  assert.equal(new Set(keys).size, NUDGE_OFFSETS.length, "a repeated offset is a wasted try");

  const firstVertical = NUDGE_OFFSETS.findIndex((offset) => {
    return offset.x === 0 && offset.y !== 0;
  });
  const firstHorizontal = NUDGE_OFFSETS.findIndex((offset) => {
    return offset.x !== 0;
  });
  // A name shifted up or down still reads as belonging to the same country; a
  // horizontal shift drifts toward a neighbour.
  assert.ok(firstVertical > 0);
  assert.ok(firstVertical < firstHorizontal, "vertical nudges must be tried before horizontal");

  for (const offset of NUDGE_OFFSETS) {
    assert.ok(Math.abs(offset.x) <= 1, "a nudge must not fling the label across the map");
    assert.ok(Math.abs(offset.y) <= 3);
  }
});

test("the font ramp is anchored to the real 3653 x 2855 map at its opening size", () => {
  // `referenceScale` 0.32 is the fit scale of the authoritative map in a
  // roughly 1150 px viewport, which is what the app opens at.
  const fit = fitScale(MAP, { width: 1150, height: 900 });
  assert.ok(
    Math.abs(LABEL_FONT_RAMP.referenceScale - fit) < 0.01,
    "referenceScale " + LABEL_FONT_RAMP.referenceScale + " vs the real fit scale " + fit,
  );
  assert.ok(
    Math.abs(labelFontSize(fit) - LABEL_FONT_RAMP.basePx) < 0.5,
    "the opening view must draw at about basePx",
  );
  // The zoom range runs fit..MAX_SCALE, and both ends must be inside the clamp.
  assert.equal(labelFontSize(MAX_SCALE), LABEL_FONT_RAMP.maxPx);
  assert.ok(labelFontSize(fit) > LABEL_FONT_RAMP.minPx);
  assert.ok(labelFontSize(fit) < LABEL_FONT_RAMP.maxPx);
});

// --- labelFontSize with a supplied ramp ------------------------------------

test("a caller-supplied ramp is used in place of the default, clamps included", () => {
  const linear = { referenceScale: 1, basePx: 10, exponent: 1, minPx: 0, maxPx: 1000 };
  assert.equal(labelFontSize(2, linear), 20);
  assert.equal(labelFontSize(0.5, linear), 5);
  assert.equal(labelFontSize(1000, { ...linear, maxPx: 12 }), 12);
  assert.equal(labelFontSize(0.001, { ...linear, minPx: 4 }), 4);
  // The default is untouched by any of that.
  assert.equal(labelFontSize(LABEL_FONT_RAMP.referenceScale), LABEL_FONT_RAMP.basePx);
});

test("a degenerate ramp falls back to minPx instead of leaking NaN or Infinity", () => {
  // scale / 0 is Infinity, and a negative reference scale makes Math.pow NaN.
  // Either one would put a non-finite font size into every collision rect.
  assert.equal(labelFontSize(1, { ...LABEL_FONT_RAMP, referenceScale: 0 }), LABEL_FONT_RAMP.minPx);
  assert.equal(labelFontSize(1, { ...LABEL_FONT_RAMP, referenceScale: -1 }), LABEL_FONT_RAMP.minPx);
});

// --- chamferDistance -------------------------------------------------------

test("chamferDistance survives an empty or negative grid without throwing", () => {
  assert.equal(chamferDistance(new Uint8Array(0), 0, 0).length, 0);
  assert.equal(chamferDistance(new Uint8Array(0), -3, 4).length, 0);
});

test("chamferDistance indexes row-major, so cols and rows cannot be swapped", () => {
  // 5 wide, 3 tall, the rightmost column empty. Transposing the grid gives a
  // completely different field, so this pins the indexing.
  const cols = 5;
  const rows = 3;
  const mask = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      mask[r * cols + c] = c < 4 ? 1 : 0;
    }
  }

  assert.deepEqual(
    Array.from(chamferDistance(mask, cols, rows)),
    [1, 1, 1, 1, 0, 1, 2, 2, 1, 0, 1, 1, 1, 1, 0],
  );
});

test("no in-shape cell keeps its Infinity seed — both passes reach everywhere", () => {
  const cols = 9;
  const rows = 7;
  const mask = new Uint8Array(cols * rows);
  for (let i = 0; i < mask.length; i += 1) {
    // An arbitrary but deterministic speckle, so the field is not a nice blob.
    mask[i] = (i * 7) % 5 === 0 ? 0 : 1;
  }
  const distance = chamferDistance(mask, cols, rows);
  for (let i = 0; i < distance.length; i += 1) {
    assert.ok(Number.isFinite(distance[i]), "cell " + i + " is " + distance[i]);
    if (mask[i] !== 0) {
      assert.ok(distance[i] >= 1, "an in-shape cell is at least one step from the background");
    }
  }
});

// --- findInteriorPoint options --------------------------------------------

test("the grid options are floored and clamped, never taken raw", () => {
  const bounds = box(0, 0, 90, 60);
  const inside = (): boolean => {
    return true;
  };
  // Only the right half is in the shape, so a 1 x 1 grid samples a point that
  // is OUTSIDE and finds nothing. The clamp to 3 is what saves it.
  const rightHalf = (x: number): boolean => {
    return x > 45;
  };

  const clamped = findInteriorPoint(bounds, rightHalf, { cells: 1, levels: 1 });
  assert.notEqual(clamped, null, "a 1 x 1 grid would miss the shape entirely");
  assert.deepEqual(
    clamped,
    findInteriorPoint(bounds, rightHalf, { cells: 3, levels: 1 }),
    "fewer than 3 cells is clamped up to 3",
  );
  assert.deepEqual(
    findInteriorPoint(bounds, inside, { cells: 6, levels: 0 }),
    findInteriorPoint(bounds, inside, { cells: 6, levels: 1 }),
    "fewer than 1 level is clamped up to 1",
  );
  assert.deepEqual(
    findInteriorPoint(bounds, inside, { cells: 6.9, levels: 1 }),
    findInteriorPoint(bounds, inside, { cells: 6, levels: 1 }),
    "a fractional cell count is floored",
  );
});

test("a non-numeric grid option gives up rather than throwing", () => {
  const bounds = box(0, 0, 90, 60);
  assert.equal(
    findInteriorPoint(
      bounds,
      () => {
        return true;
      },
      { cells: Number.NaN },
    ),
    null,
  );
});

test("the pole search costs exactly GRID_LEVELS * GRID_CELLS² probes", () => {
  // DESIGN section 4.3 budgets 1728 bitmap reads. This is the guard on that
  // number: it runs per country on a cache miss.
  let probes = 0;
  const point = findInteriorPoint(box(0, 0, 120, 120), () => {
    probes += 1;
    return true;
  });
  assert.notEqual(point, null);
  assert.equal(probes, GRID_LEVELS * GRID_CELLS * GRID_CELLS);
  assert.equal(probes, 1728);
});

// --- resolveLabelAnchor guards --------------------------------------------

test("a non-finite centroid is skipped without ever being tested for containment", () => {
  const asked: Point[] = [];
  const contains: ContainsFn = (_id, x, y) => {
    asked.push({ x, y });
    return x === 50 && y === 50;
  };

  const anchor = resolveLabelAnchor({
    countryId: 3,
    centroid: { x: Number.NaN, y: 10 },
    provinces: [province({ x: 50, y: 50 })],
    contains,
  });

  assert.notEqual(anchor, null);
  assert.equal(anchor?.source, "province");
  assert.deepEqual(anchor?.point, { x: 50, y: 50 });
  for (const point of asked) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), "asked about a NaN pixel");
  }
});

test("a province with non-finite coordinates is skipped and the next one answers", () => {
  const asked: Point[] = [];
  const contains: ContainsFn = (_id, x, y) => {
    asked.push({ x, y });
    return true;
  };

  const anchor = resolveLabelAnchor({
    countryId: 4,
    centroid: null,
    provinces: [
      province({ x: Number.NaN, y: 1, pixelCount: 900 }),
      province({ x: 50, y: 60, pixelCount: 400 }),
    ],
    contains,
  });

  assert.equal(anchor?.source, "province");
  assert.deepEqual(anchor?.point, { x: 50, y: 60 });
  assert.deepEqual(asked, [{ x: 50, y: 60 }], "the NaN candidate must not reach the bitmap");
});

test("the returned anchor is a copy, so the caller cannot corrupt the centroid", () => {
  const centroid = { x: 10, y: 20 };
  const anchor = resolveLabelAnchor({
    countryId: 1,
    centroid,
    provinces: [],
    contains: () => {
      return true;
    },
  });

  assert.equal(anchor?.source, "centroid");
  assert.notEqual(anchor?.point, centroid, "the aggregate's centroid must not be aliased");
  if (anchor !== null) {
    anchor.point.x = 999;
  }
  assert.deepEqual(centroid, { x: 10, y: 20 });
});

test("the grid options reach the pole search", () => {
  // A 3 x 3 single-level grid over the largest province's box, so the probe
  // count is 9 and not the 1728 of the default.
  let probes = 0;
  const contains: ContainsFn = (_id, x, y) => {
    probes += 1;
    return Math.hypot(x - 30, y - 30) < 10;
  };

  const anchor = resolveLabelAnchor({
    countryId: 2,
    centroid: { x: 0, y: 0 },
    provinces: [province({ x: 59, y: 59, bounds: box(0, 0, 60, 60) })],
    contains,
    grid: { cells: 3, levels: 1 },
  });

  assert.equal(anchor?.source, "pole");
  assert.deepEqual(anchor?.point, { x: 30, y: 30 });
  assert.equal(probes, 1 + 1 + 9, "one centroid, one province centre, then a 3 x 3 grid");
});

test("a failed pole search gives no anchor at all, never a guessed point", () => {
  // The largest province's box is degenerate, so `findInteriorPoint` returns
  // null. A "just use the bbox centre" fallback here is what puts a label in
  // the sea.
  const anchor = resolveLabelAnchor({
    countryId: 9,
    centroid: null,
    provinces: [province({ x: 5, y: 5, bounds: box(10, 10, 0, 0) })],
    contains: () => {
      return false;
    },
  });
  assert.equal(anchor, null);
});

// --- layoutLabels guards and option overrides ------------------------------

test("an anchor beyond COORD_LIMIT is dropped, so no absurd rect is ever built", () => {
  const far = layoutLabels({
    candidates: [candidate({})],
    view: view(1, COORD_LIMIT * 2, 0),
    viewport: VIEWPORT,
  });
  assert.deepEqual(far, [], "past the limit");

  const near = layoutLabels({
    candidates: [candidate({})],
    view: view(1, COORD_LIMIT / 2, 0),
    viewport: VIEWPORT,
  });
  assert.equal(near.length, 1, "inside the limit it is placed, just not visible");
  assert.equal(near[0].visible, false);
});

test("a non-finite anchor is dropped", () => {
  for (const anchor of [
    { x: Number.NaN, y: 100 },
    { x: 100, y: Number.NaN },
    { x: Number.POSITIVE_INFINITY, y: 0 },
  ]) {
    assert.deepEqual(
      layoutLabels({
        candidates: [candidate({ anchor })],
        view: view(1, 0, 0),
        viewport: VIEWPORT,
      }),
      [],
      JSON.stringify(anchor),
    );
  }
});

test("the padding options are honoured and the draw origin follows them", () => {
  const tight = layoutLabels({
    candidates: [candidate({})],
    view: view(1, 0, 0),
    viewport: VIEWPORT,
    paddingX: 0,
    paddingY: 0,
  });
  assert.equal(tight.length, 1);
  assert.equal(tight[0].rect.width, 100, "no padding means the rect IS the text");
  assert.equal(tight[0].rect.height, 20);
  assert.equal(tight[0].x, tight[0].rect.x);

  const padded = layoutLabels({
    candidates: [candidate({})],
    view: view(1, 0, 0),
    viewport: VIEWPORT,
  });
  assert.equal(padded[0].rect.width, 100 + LABEL_PADDING_X * 2);
  assert.equal(padded[0].rect.height, 20 + LABEL_PADDING_Y * 2);
});

test("the fit ratios are overridable, and the defaults are what hide the label", () => {
  // 104 map px of width at scale 1 is under 100 * 1.05, so the default drops it.
  const narrow = candidate({ bounds: box(0, 0, 104, 4000) });
  assert.deepEqual(
    layoutLabels({ candidates: [narrow], view: view(1, 0, 0), viewport: VIEWPORT }),
    [],
    "the default width ratio hides it",
  );
  assert.equal(
    layoutLabels({
      candidates: [narrow],
      view: view(1, 0, 0),
      viewport: VIEWPORT,
      fitWidthRatio: 1,
    }).length,
    1,
  );

  // 31 px of height is under 20 * 1.6.
  const short = candidate({ bounds: box(0, 0, 4000, 31) });
  assert.deepEqual(
    layoutLabels({ candidates: [short], view: view(1, 0, 0), viewport: VIEWPORT }),
    [],
    "the default height ratio hides it",
  );
  assert.equal(
    layoutLabels({
      candidates: [short],
      view: view(1, 0, 0),
      viewport: VIEWPORT,
      fitHeightRatio: 1.5,
    }).length,
    1,
  );
});

test("layoutLabels does not reorder the caller's array", () => {
  // It sorts a copy. Sorting in place would reorder `countryLabelSources` and
  // make the next frame's greedy pass read a mutated list.
  const list = [
    candidate({ countryId: 1, area: 10 }),
    candidate({ countryId: 2, area: 900, anchor: { x: 900, y: 400 } }),
    candidate({ countryId: 3, area: 500, anchor: { x: 400, y: 700 } }),
  ];
  const before = list.slice();

  layoutLabels({
    candidates: list,
    view: view(1, 0, 0),
    viewport: VIEWPORT,
    contains: () => {
      return true;
    },
  });

  for (let i = 0; i < before.length; i += 1) {
    assert.equal(list[i], before[i], "entry " + i + " moved");
  }
});

test("contains is never consulted when nothing collides", () => {
  // Offset 0 IS the anchor, and the anchor was already proven in-country when
  // it was resolved. Re-testing it costs a bitmap read per label per frame.
  let probes = 0;
  const placements = layoutLabels({
    candidates: [candidate({})],
    view: view(1, 0, 0),
    viewport: VIEWPORT,
    contains: () => {
      probes += 1;
      return true;
    },
  });
  assert.equal(placements.length, 1);
  assert.equal(placements[0].offsetIndex, 0);
  assert.equal(probes, 0);
});

test("with contains omitted every nudge is allowed", () => {
  const anchor = { x: 500, y: 400 };
  const placements = layoutLabels({
    candidates: [
      candidate({ countryId: 1, area: 200, anchor }),
      candidate({ countryId: 2, area: 100, anchor }),
    ],
    view: view(1, 0, 0),
    viewport: VIEWPORT,
  });
  assert.equal(placements.length, 2, "the default predicate accepts every offset");
  assert.ok(placements[1].offsetIndex > 0);
});

test("a zero-sized viewport places every label and draws none", () => {
  const placements = layoutLabels({
    candidates: [candidate({})],
    view: view(1, 0, 0),
    viewport: { width: 0, height: 0 },
  });
  assert.equal(placements.length, 1);
  assert.equal(placements[0].visible, false);
});

test("visibility uses the same flush rule as collision — touching is outside", () => {
  const viewport: Size = { width: 200, height: 800 };
  // boxW is 100 + 6 * 2, so rect.x is anchor.x - 56.
  const flush = layoutLabels({
    candidates: [candidate({ anchor: { x: 256, y: 100 } })],
    view: view(1, 0, 0),
    viewport,
  });
  assert.equal(flush[0].rect.x, 200);
  assert.equal(flush[0].visible, false, "a rect flush with the edge shows nothing");

  const inside = layoutLabels({
    candidates: [candidate({ anchor: { x: 255, y: 100 } })],
    view: view(1, 0, 0),
    viewport,
  });
  assert.equal(inside[0].rect.x, 199);
  assert.equal(inside[0].visible, true, "one pixel in and it draws");
});
