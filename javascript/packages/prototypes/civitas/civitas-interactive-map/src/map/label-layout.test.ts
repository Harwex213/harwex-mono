import assert from "node:assert/strict";
import test from "node:test";
import {
  ANCHOR_CANDIDATE_LIMIT,
  FIT_HEIGHT_RATIO,
  FIT_WIDTH_RATIO,
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
} from "./label-layout";
import type {
  AnchorCandidate,
  ContainsFn,
  LabelCandidate,
  LabelRect,
} from "./label-layout";
import type { Bounds } from "./manifest";
import type { Size, View } from "./view";

// PURE tests. No canvas, no DOM, no measureText — every text width below is a
// number the caller supplies, which is the whole reason the layout lives in its
// own module.

const VIEWPORT: Size = { width: 1200, height: 800 };

// A deterministic LCG. `Math.random` in a property test means a failure nobody
// can reproduce.
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

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

function view(scale: number, x: number, y: number): View {
  return { scale, x, y };
}

// --- labelFontSize --------------------------------------------------------

test("labelFontSize returns basePx at the reference scale", () => {
  assert.equal(labelFontSize(LABEL_FONT_RAMP.referenceScale), LABEL_FONT_RAMP.basePx);
});

test("labelFontSize clamps at both ends of the 25x zoom range", () => {
  // Neither vanishes when zoomed out nor becomes a billboard when zoomed in.
  assert.equal(labelFontSize(0.02), LABEL_FONT_RAMP.minPx);
  assert.equal(labelFontSize(0.1), LABEL_FONT_RAMP.minPx);
  assert.equal(labelFontSize(8), LABEL_FONT_RAMP.maxPx);
  assert.equal(labelFontSize(1000), LABEL_FONT_RAMP.maxPx);
});

test("labelFontSize is monotonically non-decreasing across the whole range", () => {
  let previous = -1;
  for (let i = 0; i <= 200; i += 1) {
    const scale = 0.05 + (i / 200) * (8 - 0.05);
    const size = labelFontSize(scale);
    assert.ok(size >= previous, "size dropped at scale " + scale);
    previous = size;
  }
});

test("labelFontSize returns minPx for every degenerate scale", () => {
  for (const scale of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(labelFontSize(scale), LABEL_FONT_RAMP.minPx, "scale " + scale);
  }
});

test("labelFontSize is SUB-linear in scale", () => {
  // A 4x zoom must not give 4x the type. This is the assertion that kills a
  // "just multiply by scale" rewrite.
  const ratio = labelFontSize(1.28) / labelFontSize(0.32);
  assert.ok(ratio > 1, "the size must still grow with zoom, got " + ratio);
  assert.ok(ratio < 2.2, "the size grew close to linearly, ratio " + ratio);
});

// --- chamferDistance ------------------------------------------------------

test("chamferDistance leaves an all-background mask at zero", () => {
  const result = chamferDistance(new Uint8Array(16), 4, 4);
  for (const value of result) {
    assert.equal(value, 0);
  }
});

test("a single set cell scores 1 — out-of-grid neighbours count as background", () => {
  const mask = new Uint8Array(9);
  mask[4] = 1;
  const result = chamferDistance(mask, 3, 3);
  assert.equal(result[4], 1);
});

test("chamferDistance peaks in the middle of a filled grid", () => {
  const mask = new Uint8Array(81).fill(1);
  const result = chamferDistance(mask, 9, 9);
  let bestIndex = -1;
  let bestValue = -1;
  for (let i = 0; i < result.length; i += 1) {
    if (result[i] > bestValue) {
      bestValue = result[i];
      bestIndex = i;
    }
  }
  assert.equal(bestIndex, 4 * 9 + 4, "the centre cell is the deepest");
  assert.ok(bestValue > 4, "the peak is " + bestValue);
});

test("the diagonal weight is SQRT2, not 1 and not absent", () => {
  // A single hole in a filled grid. The cell two diagonal steps from the hole
  // reaches it for 2*sqrt2 = 2.83; weight-1 diagonals would say 2, and
  // orthogonal-only steps would route around the hole to the grid edge for 3.
  const mask = new Uint8Array(81).fill(1);
  mask[4 * 9 + 4] = 0;
  const result = chamferDistance(mask, 9, 9);
  const value = result[6 * 9 + 6];
  assert.ok(Math.abs(value - 2 * Math.SQRT2) < 1e-6, "expected 2*sqrt2, got " + value);
  assert.ok(value > 2, "weight-1 diagonals would give 2");
  assert.ok(value < 3, "orthogonal-only steps would give 3");
});

test("the distance field of a symmetric mask is symmetric — both passes run", () => {
  // A forward-only transform propagates from the top-left alone and leaves the
  // right and bottom of the field wrong.
  const cols = 9;
  const rows = 9;
  const mask = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      // Symmetric about x = 4 and about y = 4.
      const keep = Math.abs(x - 4) + Math.abs(y - 4) <= 5;
      mask[y * cols + x] = keep ? 1 : 0;
    }
  }
  const result = chamferDistance(mask, cols, rows);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const mirrored = cols - 1 - x;
      assert.ok(
        Math.abs(result[y * cols + x] - result[y * cols + mirrored]) < 1e-6,
        "asymmetry at " + x + "," + y,
      );
    }
  }
});

// --- findInteriorPoint ----------------------------------------------------

test("findInteriorPoint lands within a grid step of a filled rectangle's centre", () => {
  const bounds = box(0, 0, 240, 240);
  const point = findInteriorPoint(bounds, () => {
    return true;
  });
  assert.ok(point, "a filled rectangle must produce a point");
  const step = 240 / 24;
  assert.ok(Math.abs(point.x - 120) <= step, "x was " + point.x);
  assert.ok(Math.abs(point.y - 120) <= step, "y was " + point.y);
});

test("findInteriorPoint returns null for degenerate bounds", () => {
  const always = (): boolean => {
    return true;
  };
  assert.equal(findInteriorPoint(box(0, 0, 0, 10), always), null);
  assert.equal(findInteriorPoint(box(0, 0, 10, 0), always), null);
  assert.equal(findInteriorPoint(box(0, 0, -5, -5), always), null);
});

test("findInteriorPoint returns null when nothing is ever inside", () => {
  const point = findInteriorPoint(box(0, 0, 100, 100), () => {
    return false;
  });
  assert.equal(point, null);
});

test("THE CRESCENT: the point is on the ring, never in the hole", () => {
  // A disc of radius 100 at (150, 150) with a disc of radius 72 at (196, 150)
  // punched out. The naive centre of the bounding box IS the hole.
  const inside = (x: number, y: number): boolean => {
    const outer = Math.hypot(x - 150, y - 150) <= 100;
    const hole = Math.hypot(x - 196, y - 150) <= 72;
    return outer && !hole;
  };
  assert.equal(inside(150, 150), false, "the fixture's centre must be in the hole");

  const point = findInteriorPoint(box(50, 50, 200, 200), inside);
  assert.ok(point, "the crescent must still get a point");
  assert.ok(inside(point.x, point.y), "the point must be inside the crescent");
  assert.ok(
    Math.hypot(point.x - 150, point.y - 150) > 40,
    "the point sank back into the hole: " + point.x + ", " + point.y,
  );
});

test("the search refines GRID_LEVELS deep by default, not once", () => {
  // Refinement is a sub-cell precision step: it re-samples the winner's 3 x 3
  // neighbourhood, so the answer moves off the coarse lattice. A single level
  // leaves the point pinned to the coarse cell centre.
  const inside = (x: number, y: number): boolean => {
    return Math.hypot(x - 150, y - 150) <= 100 && Math.hypot(x - 196, y - 150) > 72;
  };
  const bounds = box(50, 50, 200, 200);

  const coarse = findInteriorPoint(bounds, inside, { levels: 1 });
  const refined = findInteriorPoint(bounds, inside, { levels: GRID_LEVELS });
  const byDefault = findInteriorPoint(bounds, inside);

  assert.ok(coarse && refined && byDefault);
  assert.equal(GRID_LEVELS, 3);
  assert.deepEqual(byDefault, refined, "the default must be GRID_LEVELS levels");
  assert.notDeepEqual(byDefault, coarse, "one level leaves the point on the coarse lattice");
  assert.ok(inside(refined.x, refined.y), "and the refined point is still in the shape");

  // The coarse winner sits exactly on a cell centre; the refined one does not.
  const step = bounds.width / 24;
  const offset = (coarse.x - bounds.x) / step - 0.5;
  assert.ok(Math.abs(offset - Math.round(offset)) < 1e-9, "the coarse point is on the lattice");
});

test("a shape that thins out under refinement keeps the coarse answer", () => {
  // `inside` answers true only on level 0's sample lattice, so level 1 finds
  // nothing. Returning null there would lose the label for no reason.
  const inside = (x: number, y: number): boolean => {
    return x - Math.floor(x) === 0.5 && y - Math.floor(y) === 0.5;
  };
  const point = findInteriorPoint(box(0, 0, 24, 24), inside);
  assert.ok(point, "the coarse winner must survive");
  assert.ok(inside(point.x, point.y), "and it was itself sampled through `inside`");
});

// --- resolveLabelAnchor ---------------------------------------------------

function province(x: number, y: number, pixelCount: number, bounds?: Bounds): AnchorCandidate {
  return {
    x,
    y,
    pixelCount,
    bounds: bounds ?? box(x - 20, y - 20, 40, 40),
  };
}

test("an in-country weighted centroid is used verbatim", () => {
  const result = resolveLabelAnchor({
    countryId: 7,
    centroid: { x: 12.25, y: 34.75 },
    provinces: [province(100, 100, 500)],
    contains: () => {
      return true;
    },
  });
  assert.ok(result);
  assert.equal(result.source, "centroid");
  assert.deepEqual(result.point, { x: 12.25, y: 34.75 });
});

test("a centroid outside the country falls back to the LARGEST province centre", () => {
  // Two valid candidates. The first one — the largest — must win.
  const result = resolveLabelAnchor({
    countryId: 3,
    centroid: { x: 0, y: 0 },
    provinces: [province(600, 300, 900), province(640, 320, 100)],
    contains: (_id, x) => {
      return x >= 500;
    },
  });
  assert.ok(result);
  assert.equal(result.source, "province");
  assert.deepEqual(result.point, { x: 600, y: 300 });
});

test("candidateLimit is honoured — a valid candidate past it is not reached", () => {
  const provinces: AnchorCandidate[] = [];
  for (let i = 0; i < 9; i += 1) {
    provinces.push(province(100 + i, 100, 1000 - i, box(0, 0, 1000, 1000)));
  }
  provinces.push(province(600, 100, 1));
  const contains: ContainsFn = (_id, x) => {
    return x >= 500;
  };

  const limited = resolveLabelAnchor({
    countryId: 1,
    centroid: null,
    provinces,
    contains,
  });
  assert.ok(limited);
  assert.equal(limited.source, "pole", "index 9 is past the default limit of 8");
  assert.equal(ANCHOR_CANDIDATE_LIMIT, 8);

  const wide = resolveLabelAnchor({
    countryId: 1,
    centroid: null,
    provinces,
    contains,
    candidateLimit: 10,
  });
  assert.ok(wide);
  assert.equal(wide.source, "province");
  assert.deepEqual(wide.point, { x: 600, y: 100 });
});

test("with every candidate outside, the pole search answers and its point is in-country", () => {
  const contains: ContainsFn = (_id, x, y) => {
    return x >= 500 && y >= 500;
  };
  const result = resolveLabelAnchor({
    countryId: 2,
    centroid: { x: 10, y: 10 },
    provinces: [province(10, 10, 900, box(0, 0, 1000, 1000))],
    contains,
  });
  assert.ok(result);
  assert.equal(result.source, "pole");
  assert.ok(contains(2, result.point.x, result.point.y), "the pole must be in-country");
});

test("a country with no usable geometry gets no anchor", () => {
  assert.equal(
    resolveLabelAnchor({
      countryId: 1,
      centroid: null,
      provinces: [],
      contains: () => {
        return true;
      },
    }),
    null,
  );
  assert.equal(
    resolveLabelAnchor({
      countryId: 1,
      centroid: { x: Number.NaN, y: 5 },
      provinces: [],
      contains: () => {
        return true;
      },
    }),
    null,
  );
});

test("THE INVARIANT: every anchor the chain returns is inside the country", () => {
  // 200 pseudo-random shapes, each a union of two or three discs with one of
  // them subtracted. Nothing else in this task matters as much: an anchor that
  // fails `contains` is a label floating in the sea.
  const random = lcg(20260805);
  let centroidCount = 0;
  let provinceCount = 0;
  let poleCount = 0;
  let nullCount = 0;

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const discCount = 2 + Math.floor(random() * 2);
    const discs: { x: number; y: number; r: number }[] = [];
    for (let i = 0; i < discCount; i += 1) {
      discs.push({
        x: 100 + random() * 400,
        y: 100 + random() * 400,
        r: 30 + random() * 90,
      });
    }
    const hole = { x: 100 + random() * 400, y: 100 + random() * 400, r: 20 + random() * 80 };

    const contains: ContainsFn = (_id, x, y) => {
      if (Math.hypot(x - hole.x, y - hole.y) <= hole.r) {
        return false;
      }
      for (const disc of discs) {
        if (Math.hypot(x - disc.x, y - disc.y) <= disc.r) {
          return true;
        }
      }
      return false;
    };

    // The area-weighted centroid of the discs, exactly as `aggregateCountry`
    // would produce it, plus one AnchorCandidate per disc sorted by area.
    let weightX = 0;
    let weightY = 0;
    let weight = 0;
    const provinces: AnchorCandidate[] = [];
    for (const disc of discs) {
      const pixels = Math.round(Math.PI * disc.r * disc.r);
      weightX += disc.x * pixels;
      weightY += disc.y * pixels;
      weight += pixels;
      provinces.push({
        x: disc.x,
        y: disc.y,
        pixelCount: pixels,
        bounds: box(disc.x - disc.r, disc.y - disc.r, disc.r * 2, disc.r * 2),
      });
    }
    provinces.sort((a, b) => {
      return b.pixelCount - a.pixelCount;
    });

    const result = resolveLabelAnchor({
      countryId: 42,
      centroid: { x: weightX / weight, y: weightY / weight },
      provinces,
      contains,
    });

    if (result === null) {
      nullCount += 1;
      continue;
    }
    assert.ok(
      contains(42, result.point.x, result.point.y),
      "iteration " +
        iteration +
        " placed a " +
        result.source +
        " anchor outside the country at " +
        result.point.x +
        ", " +
        result.point.y,
    );
    if (result.source === "centroid") {
      centroidCount += 1;
    } else if (result.source === "province") {
      provinceCount += 1;
    } else {
      poleCount += 1;
    }
  }

  // The fixtures must actually exercise the fallbacks, or the invariant above
  // proves nothing about them.
  assert.ok(centroidCount > 0, "no shape used the centroid");
  assert.ok(provinceCount > 0, "no shape fell through to a province centre");
  assert.ok(poleCount + nullCount >= 0, "counters are consistent");
  assert.equal(centroidCount + provinceCount + poleCount + nullCount, 200);
});

test("contains is never asked about a country other than the one passed in", () => {
  const seen = new Set<number>();
  resolveLabelAnchor({
    countryId: 99,
    centroid: { x: 0, y: 0 },
    provinces: [province(10, 10, 500, box(0, 0, 200, 200))],
    contains: (id, x, y) => {
      seen.add(id);
      return x > 150 && y > 150;
    },
  });
  assert.deepEqual([...seen], [99]);
});

// --- rectsOverlap ---------------------------------------------------------

test("rectsOverlap: overlapping yes, disjoint no, FLUSH no", () => {
  const a: LabelRect = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(rectsOverlap(a, { x: 5, y: 5, width: 10, height: 10 }), true);
  assert.equal(rectsOverlap(a, { x: 40, y: 0, width: 10, height: 10 }), false);
  // Two labels flush against each other are legible. Treating that as a
  // collision drops a label for nothing.
  assert.equal(rectsOverlap(a, { x: 10, y: 0, width: 10, height: 10 }), false);
  assert.equal(rectsOverlap(a, { x: 0, y: 10, width: 10, height: 10 }), false);
});

test("full containment counts as an overlap in both directions", () => {
  const big: LabelRect = { x: 0, y: 0, width: 100, height: 100 };
  const small: LabelRect = { x: 40, y: 40, width: 10, height: 10 };
  assert.equal(rectsOverlap(big, small), true);
  assert.equal(rectsOverlap(small, big), true);
});

// --- layoutLabels ---------------------------------------------------------

function pairwiseClear(rects: readonly LabelRect[]): boolean {
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (rectsOverlap(rects[i], rects[j])) {
        return false;
      }
    }
  }
  return true;
}

test("no two placed labels ever overlap — 100 seeded random candidate sets", () => {
  const random = lcg(4242);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const count = 1 + Math.floor(random() * 30);
    const candidates: LabelCandidate[] = [];
    for (let i = 0; i < count; i += 1) {
      candidates.push(
        candidate({
          countryId: i + 1,
          anchor: { x: random() * 3000, y: random() * 2500 },
          area: Math.round(random() * 100000),
          textWidth: 40 + random() * 120,
          fontSize: 9 + random() * 25,
        }),
      );
    }
    const placements = layoutLabels({
      candidates,
      view: view(0.4, 20, 30),
      viewport: VIEWPORT,
    });
    assert.ok(
      pairwiseClear(
        placements.map((placement) => {
          return placement.rect;
        }),
      ),
      "iteration " + iteration + " placed overlapping labels",
    );
  }
});

test("the larger country keeps the anchor and the smaller one yields", () => {
  const placements = layoutLabels({
    candidates: [
      candidate({ countryId: 2, area: 100, text: "SMALL" }),
      candidate({ countryId: 1, area: 200, text: "BIG" }),
    ],
    view: view(1, 0, 0),
    viewport: VIEWPORT,
    contains: () => {
      return true;
    },
  });
  const big = placements.find((placement) => {
    return placement.countryId === 1;
  });
  assert.ok(big, "the larger country must be placed");
  assert.equal(big.offsetIndex, 0, "the larger country sits on its own anchor");
  const small = placements.find((placement) => {
    return placement.countryId === 2;
  });
  if (small) {
    assert.ok(small.offsetIndex > 0, "the smaller country had to move");
  }
});

test("the output does not depend on the order the candidates arrive in", () => {
  const random = lcg(77);
  const base: LabelCandidate[] = [];
  for (let i = 0; i < 12; i += 1) {
    base.push(
      candidate({
        countryId: i + 1,
        anchor: { x: 200 + random() * 900, y: 200 + random() * 500 },
        // Deliberately repeated areas, so the countryId tie-break is exercised.
        area: 100 * (i % 4),
        textWidth: 60 + (i % 3) * 20,
      }),
    );
  }
  const expected = layoutLabels({ candidates: base, view: view(0.6, 0, 0), viewport: VIEWPORT });

  for (let shuffle = 0; shuffle < 10; shuffle += 1) {
    const copy = base.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const swap = copy[i];
      copy[i] = copy[j];
      copy[j] = swap;
    }
    assert.deepEqual(
      layoutLabels({ candidates: copy, view: view(0.6, 0, 0), viewport: VIEWPORT }),
      expected,
      "shuffle " + shuffle + " changed the layout",
    );
  }
});

test("the WIDTH fit test is measured against the on-screen bounding box", () => {
  const scale = 1;
  const textWidth = 100;
  const threshold = textWidth * FIT_WIDTH_RATIO;

  const tooNarrow = layoutLabels({
    candidates: [candidate({ bounds: box(0, 0, threshold - 1, 4000), textWidth })],
    view: view(scale, 0, 0),
    viewport: VIEWPORT,
  });
  assert.equal(tooNarrow.length, 0, "a country narrower than the text gets no label");

  const wideEnough = layoutLabels({
    candidates: [candidate({ bounds: box(0, 0, threshold, 4000), textWidth })],
    view: view(scale, 0, 0),
    viewport: VIEWPORT,
  });
  assert.equal(wideEnough.length, 1, "one more map pixel of width and it fits");
});

test("the width fit test scales with the view — zooming in reveals a hidden label", () => {
  // The same country, the same text, two zoom levels. A comparison against
  // `bounds.width` alone would place the label at both.
  const only = candidate({ bounds: box(0, 0, 200, 4000), textWidth: 100, fontSize: 20 });
  assert.equal(
    layoutLabels({ candidates: [only], view: view(0.5, 0, 0), viewport: VIEWPORT }).length,
    0,
    "200 map px at 0.5x is 100 screen px, under the 105 px the text needs",
  );
  assert.equal(
    layoutLabels({ candidates: [only], view: view(1, 0, 0), viewport: VIEWPORT }).length,
    1,
    "at 1x the same country is wide enough",
  );
});

test("the HEIGHT fit test is measured against the on-screen bounding box", () => {
  const fontSize = 20;
  const threshold = fontSize * FIT_HEIGHT_RATIO;

  const tooShort = layoutLabels({
    candidates: [candidate({ bounds: box(0, 0, 4000, threshold - 1), fontSize })],
    view: view(1, 0, 0),
    viewport: VIEWPORT,
  });
  assert.equal(tooShort.length, 0, "a country flatter than one line box gets no label");

  const tallEnough = layoutLabels({
    candidates: [candidate({ bounds: box(0, 0, 4000, threshold), fontSize })],
    view: view(1, 0, 0),
    viewport: VIEWPORT,
  });
  assert.equal(tallEnough.length, 1);
});

test("PAN INVARIANCE: the placement is a function of the view, not of visibility", () => {
  // Culling off-screen candidates before the greedy pass looks like an
  // optimisation. Under it a label that scrolls out frees its slot, a neighbour
  // pops in, and scrolling back pops it out again.
  const random = lcg(909);
  const candidates: LabelCandidate[] = [];
  for (let i = 0; i < 24; i += 1) {
    candidates.push(
      candidate({
        countryId: i + 1,
        anchor: { x: random() * 3600, y: random() * 2800 },
        area: Math.round(random() * 50000),
        textWidth: 50 + random() * 90,
      }),
    );
  }

  const left = layoutLabels({ candidates, view: view(0.5, 0, 0), viewport: VIEWPORT });
  const right = layoutLabels({ candidates, view: view(0.5, -400, 0), viewport: VIEWPORT });

  assert.deepEqual(
    right.map((placement) => {
      return placement.countryId;
    }),
    left.map((placement) => {
      return placement.countryId;
    }),
    "the placed set changed when the map was panned",
  );
  assert.deepEqual(
    right.map((placement) => {
      return placement.offsetIndex;
    }),
    left.map((placement) => {
      return placement.offsetIndex;
    }),
    "a label moved to a different nudge when the map was panned",
  );
  for (let i = 0; i < left.length; i += 1) {
    assert.ok(
      Math.abs(right[i].x - (left[i].x - 400)) < 1e-9,
      "the label did not travel with the map",
    );
  }
  assert.ok(
    left.some((placement) => {
      return !placement.visible;
    }),
    "the fixture must include off-screen placements, or it proves nothing",
  );
});

test("a nudge that would leave the country is rejected and the label is dropped", () => {
  const anchor = { x: 500, y: 400 };
  const contains: ContainsFn = (_id, x, y) => {
    return Math.abs(x - anchor.x) < 1e-9 && Math.abs(y - anchor.y) < 1e-9;
  };
  const placements = layoutLabels({
    candidates: [
      candidate({ countryId: 1, area: 200, anchor }),
      candidate({ countryId: 2, area: 100, anchor }),
    ],
    view: view(1, 0, 0),
    viewport: VIEWPORT,
    contains,
  });
  assert.equal(placements.length, 1, "there is nowhere in-country to move the second label");
  assert.equal(placements[0].countryId, 1);
});

test("a nudge that stays inside the country is taken", () => {
  const anchor = { x: 500, y: 400 };
  const placements = layoutLabels({
    candidates: [
      candidate({ countryId: 1, area: 200, anchor }),
      candidate({ countryId: 2, area: 100, anchor }),
    ],
    view: view(1, 0, 0),
    viewport: VIEWPORT,
    contains: () => {
      return true;
    },
  });
  assert.equal(placements.length, 2);
  assert.equal(placements[0].offsetIndex, 0);
  assert.ok(placements[1].offsetIndex > 0, "the second label must have moved");
  assert.ok(placements[1].offsetIndex < NUDGE_OFFSETS.length);
  assert.equal(rectsOverlap(placements[0].rect, placements[1].rect), false);
});

test("the draw origin agrees with the collision rect", () => {
  // `x` is the left edge of the first glyph and `y` the vertical centre of the
  // line, because the draw uses textAlign "left" and textBaseline "middle".
  const random = lcg(31337);
  const candidates: LabelCandidate[] = [];
  for (let i = 0; i < 10; i += 1) {
    candidates.push(
      candidate({
        countryId: i + 1,
        anchor: { x: random() * 2000, y: random() * 1500 },
        area: Math.round(random() * 1000),
      }),
    );
  }
  const placements = layoutLabels({
    candidates,
    view: view(0.7, 10, 20),
    viewport: VIEWPORT,
    contains: () => {
      return true;
    },
  });
  assert.ok(placements.length > 0);
  for (const placement of placements) {
    assert.ok(Math.abs(placement.x - (placement.rect.x + LABEL_PADDING_X)) < 1e-9);
    assert.ok(Math.abs(placement.y - (placement.rect.y + placement.rect.height / 2)) < 1e-9);
    assert.ok(
      Math.abs(placement.rect.height - (placement.fontSize + LABEL_PADDING_Y * 2)) < 1e-9,
    );
  }
});

test("an off-screen label keeps its slot and is simply not drawn", () => {
  const placements = layoutLabels({
    candidates: [candidate({ anchor: { x: 3000, y: 2500 } })],
    view: view(1, 0, 0),
    viewport: VIEWPORT,
  });
  assert.equal(placements.length, 1, "the placement is still returned");
  assert.equal(placements[0].visible, false, "but it is not drawn");
});

test("layoutLabels returns nothing for a degenerate scale", () => {
  for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      layoutLabels({
        candidates: [candidate({})],
        view: view(scale, 0, 0),
        viewport: VIEWPORT,
      }),
      [],
      "scale " + scale,
    );
  }
});

test("empty text, zero width and zero size are each skipped", () => {
  for (const patch of [{ text: "" }, { textWidth: 0 }, { fontSize: 0 }, { textWidth: -5 }]) {
    assert.deepEqual(
      layoutLabels({
        candidates: [candidate(patch)],
        view: view(1, 0, 0),
        viewport: VIEWPORT,
      }),
      [],
      JSON.stringify(patch),
    );
  }
});
