import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  OVERSCAN_ROWS,
  PROVINCE_IMAGE_STORE_BYTES,
  PROVINCE_LORE_ROWS,
  PROVINCE_ROW_HEIGHT,
  budgetText,
  buildProvinceRows,
  filterRows,
  imageSaveNoticeFor,
  imagesRemaining,
  indexOfProvince,
  matchesQuery,
  normalizeQuery,
  overrideSummary,
  scrollTopForIndex,
  windowGeometry,
  windowStart,
} from "./province-list";
import { LORE_MAX } from "../state/schema";
import { PROVINCE_IMAGE_MAX_EDGE } from "../state/image";
import { STORAGE_BUDGET_BYTES, utf16Bytes } from "../state/persistence";
import { saveNoticeFor } from "./country-overview";
import type { ProvinceLookups, ProvinceRow } from "./province-list";
import type { ProvinceOverride } from "../state/schema";
import type { SaveNoticeKind } from "./country-overview";
import type { StateWarning, WarningKind } from "../state/persistence";

// The provinces panel's pure half. The `.tsx` files are untestable — there is no
// jsdom in this repo — which is exactly why the arithmetic, the search predicate
// and the notice table were moved out of them. The wiring jsdom cannot reach is
// pinned by the source assertions at the bottom, the precedent being
// `scaffold.test.ts` and `country-overview.test.ts`.

const VIEWPORT = 600;

function readUiFile(name: string): string {
  return readFileSync(fileURLToPath(new URL("./" + name, import.meta.url)), "utf8");
}

function warning(kind: WarningKind, message = "the message"): StateWarning {
  return { kind, message, at: 0 };
}

function row(id: number, patch: Partial<ProvinceRow> = {}): ProvinceRow {
  return {
    id,
    name: "Province " + id,
    rawName: "",
    lore: "",
    imageDataUrl: null,
    edited: false,
    known: true,
    ...patch,
  };
}

function lookups(overrides: ReadonlyMap<number, ProvinceOverride>, known: readonly number[]): ProvinceLookups {
  const knownSet = new Set(known);
  return {
    displayNameOf: (id) => {
      const stored = overrides.get(id);
      if (stored && stored.name !== undefined && stored.name !== "") {
        return stored.name;
      }
      return knownSet.has(id) ? "Manifest " + id : "Province " + id;
    },
    overrideOf: (id) => {
      return overrides.get(id) ?? null;
    },
    isKnown: (id) => {
      return knownSet.has(id);
    },
  };
}

test("windowStart floors the scroll, applies the overscan and clamps at both ends", () => {
  assert.equal(windowStart(0, 196, 4, 100), 0);
  // Inside the first four rows the overscan takes the start below zero.
  assert.equal(windowStart(196 * 3, 196, 4, 100), 0);
  assert.equal(windowStart(196 * 10, 196, 4, 100), 6);
  // A partial row still floors to the row it is inside.
  assert.equal(windowStart(196 * 10 + 195, 196, 4, 100), 6);
  assert.equal(windowStart(196 * 1000, 196, 4, 100), 99);

  assert.equal(windowStart(500, 196, 4, 0), 0);
  assert.equal(windowStart(Number.NaN, 196, 4, 100), 0);
  assert.equal(windowStart(Number.POSITIVE_INFINITY, 196, 4, 100), 0);
  assert.equal(windowStart(-500, 196, 4, 100), 0);
});

test("windowGeometry reports an exclusive end, the window offset and the spacer height", () => {
  const geometry = windowGeometry(6, VIEWPORT, PROVINCE_ROW_HEIGHT, OVERSCAN_ROWS, 100);

  assert.equal(geometry.first, 6);
  assert.ok(geometry.last <= 100, "last must never exceed rowCount");
  assert.equal(geometry.offsetY, 6 * PROVINCE_ROW_HEIGHT);
  assert.equal(geometry.totalHeight, 100 * PROVINCE_ROW_HEIGHT);

  assert.deepEqual(windowGeometry(0, VIEWPORT, PROVINCE_ROW_HEIGHT, OVERSCAN_ROWS, 0), {
    first: 0,
    last: 0,
    offsetY: 0,
    totalHeight: 0,
  });
});

test("the rendered row count does not grow with the list — the virtualisation gate", () => {
  // THE TEST THAT FAILS IF SOMEONE RENDERS THE WHOLE LIST.
  const cap = Math.ceil(VIEWPORT / PROVINCE_ROW_HEIGHT) + 1 + 2 * OVERSCAN_ROWS;

  const counts = [50, 300, 1648].map((rowCount) => {
    const geometry = windowGeometry(6, VIEWPORT, PROVINCE_ROW_HEIGHT, OVERSCAN_ROWS, rowCount);
    return geometry.last - geometry.first;
  });

  assert.equal(counts[0], counts[1]);
  assert.equal(counts[1], counts[2]);
  assert.ok((counts[0] as number) <= cap, "at most " + cap + " rows, got " + counts[0]);
  assert.equal(cap, 13);
});

test("windowGeometry re-clamps a stale first after the list shrinks", () => {
  // A filter narrows 900 rows to 10 while the scroll sat near the bottom. The
  // clamp is what removes the blank frame before the browser's own `scrollTop`
  // clamp fires a `scroll` event.
  const geometry = windowGeometry(400, VIEWPORT, PROVINCE_ROW_HEIGHT, OVERSCAN_ROWS, 10);

  assert.equal(geometry.last, 10);
  assert.ok(geometry.first < 10);
  assert.equal(geometry.offsetY, geometry.first * PROVINCE_ROW_HEIGHT);
});

test("scrollTopForIndex leaves a visible row, a negative index and a past-the-end index alone", () => {
  assert.equal(scrollTopForIndex(2, 2 * 196, VIEWPORT, 196, 100), null);
  assert.equal(scrollTopForIndex(-1, 0, VIEWPORT, 196, 100), null);
  assert.equal(scrollTopForIndex(100, 0, VIEWPORT, 196, 100), null);
  assert.equal(scrollTopForIndex(Number.NaN, 0, VIEWPORT, 196, 100), null);
});

test("scrollTopForIndex aligns a near miss, centres a far jump and clamps at both ends", () => {
  // Just above the viewport: align to the top of the row.
  assert.equal(scrollTopForIndex(4, 4 * 196 + 10, VIEWPORT, 196, 100), 4 * 196);
  // Just below: align its bottom to the viewport's bottom.
  assert.equal(scrollTopForIndex(7, 4 * 196, VIEWPORT, 196, 100), 8 * 196 - VIEWPORT);

  // More than one viewport away: centred.
  const centred = scrollTopForIndex(60, 0, VIEWPORT, 196, 100);
  assert.equal(centred, 60 * 196 - (VIEWPORT - 196) / 2);

  // Clamped into [0, total - viewportHeight] at both ends.
  assert.equal(scrollTopForIndex(0, 90 * 196, VIEWPORT, 196, 100), 0);
  assert.equal(scrollTopForIndex(99, 0, VIEWPORT, 196, 100), 100 * 196 - VIEWPORT);
});

test("normalizeQuery trims, lowercases and collapses inner whitespace", () => {
  assert.equal(normalizeQuery("  Alta   Verde  "), "alta verde");
  assert.equal(normalizeQuery("\tPROVINCE\n41 "), "province 41");
  assert.equal(normalizeQuery("   "), "");
});

test("matchesQuery matches the name as a substring and the id as a PREFIX", () => {
  const alta = row(41, { name: "Alta Verde", lore: "a long history of salt" });
  // Both are named so the NAME rule cannot decide the id assertions below. A
  // placeholder "Province 141" contains "41" as a substring, which is the name
  // rule doing its job, not the id rule.
  const four12 = row(412, { name: "Nova Bela" });
  const one41 = row(141, { name: "Corvin" });

  assert.equal(matchesQuery(alta, ""), true);
  assert.equal(matchesQuery(alta, "verde"), true);
  assert.equal(matchesQuery(alta, "ALTA".toLowerCase()), true);
  assert.equal(matchesQuery(alta, "nowhere"), false);

  // The id is a prefix so `41` surfaces 41 and 412, not everything containing
  // the digits.
  assert.equal(matchesQuery(alta, "41"), true);
  assert.equal(matchesQuery(four12, "41"), true);
  assert.equal(matchesQuery(one41, "41"), false);

  // The lore is deliberately not searched.
  assert.equal(matchesQuery(alta, "salt"), false);
});

test("filterRows returns the SAME array for an empty query and a shorter one otherwise", () => {
  const rows = [row(1, { name: "Alta" }), row(2, { name: "Bela" }), row(3, { name: "Alta Nova" })];

  assert.equal(filterRows(rows, ""), rows);

  const filtered = filterRows(rows, "alta");
  assert.notEqual(filtered, rows);
  assert.deepEqual(
    filtered.map((entry) => {
      return entry.id;
    }),
    [1, 3],
  );
});

test("indexOfProvince reports -1 for null and for an absent id", () => {
  const rows = [row(4), row(9), row(16)];

  assert.equal(indexOfProvince(rows, null), -1);
  assert.equal(indexOfProvince(rows, 7), -1);
  assert.equal(indexOfProvince(rows, 9), 1);
});

test("buildProvinceRows layers the injected name and defaults every field", () => {
  const overrides = new Map<number, ProvinceOverride>([
    [2, { name: "Alta Verde" }],
    [3, { lore: "salt" }],
    [4, { imageDataUrl: "data:image/webp;base64,AAAA" }],
  ]);
  const rows = buildProvinceRows([1, 2, 3, 4], lookups(overrides, [1, 2, 3, 4]));

  // Untouched: the manifest name, no raw name, and NOT edited.
  assert.deepEqual(rows[0], {
    id: 1,
    name: "Manifest 1",
    rawName: "",
    lore: "",
    imageDataUrl: null,
    edited: false,
    known: true,
  });

  // The override wins, and `rawName` carries the raw value — the name input is
  // controlled on it so the field can be cleared.
  assert.equal(rows[1]?.name, "Alta Verde");
  assert.equal(rows[1]?.rawName, "Alta Verde");
  assert.equal(rows[1]?.edited, true);

  // A lore-only override is still "edited" but keeps the manifest name.
  assert.equal(rows[2]?.name, "Manifest 3");
  assert.equal(rows[2]?.rawName, "");
  assert.equal(rows[2]?.lore, "salt");
  assert.equal(rows[2]?.edited, true);

  assert.equal(rows[3]?.imageDataUrl, "data:image/webp;base64,AAAA");
});

test("buildProvinceRows keeps a phantom id listed and editable", () => {
  // Ids 1318 and 1458 do not exist and a stored document can name others.
  // Hiding such a row would make its override unreachable and undeletable.
  const rows = buildProvinceRows([1318], lookups(new Map(), []));

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.known, false);
  assert.equal(rows[0]?.name, "Province 1318");
});

test("overrideSummary counts edited rows and imaged rows independently", () => {
  const rows = [
    row(1),
    row(2, { edited: true }),
    row(3, { edited: true, imageDataUrl: "data:image/webp;base64,AA" }),
  ];

  assert.deepEqual(overrideSummary(rows), { edited: 2, withImage: 1 });
  assert.deepEqual(overrideSummary([]), { edited: 0, withImage: 0 });
  // The sparseness gate in the panel footer: scrolling a whole country writes
  // nothing, so this must stay 0.
  assert.equal(overrideSummary([row(1), row(2), row(3)]).edited, 0);
});

test("imagesRemaining follows the stated budget arithmetic and floors at 0", () => {
  assert.equal(PROVINCE_IMAGE_STORE_BYTES, 48000);
  assert.equal(STORAGE_BUDGET_BYTES, 4000000);
  // About 80 province images fit before the `budget` warning appears.
  assert.equal(imagesRemaining(0, STORAGE_BUDGET_BYTES, PROVINCE_IMAGE_STORE_BYTES), 83);
  assert.equal(
    imagesRemaining(STORAGE_BUDGET_BYTES / 2, STORAGE_BUDGET_BYTES, PROVINCE_IMAGE_STORE_BYTES),
    41,
  );
  // A document already over budget reads "0 more", never a negative number.
  assert.equal(imagesRemaining(9000000, STORAGE_BUDGET_BYTES, PROVINCE_IMAGE_STORE_BYTES), 0);
  assert.equal(imagesRemaining(0, STORAGE_BUDGET_BYTES, 0), 0);
});

test("budgetText reads differently with no images stored", () => {
  assert.equal(budgetText(0, 82), "no images yet · room for about 82");
  assert.equal(budgetText(1, 80), "1 image · room for about 80 more");
  assert.equal(budgetText(3, 76), "3 images · room for about 76 more");
  assert.equal(budgetText(3, -5), "3 images · room for about 0 more");
});

test("imageSaveNoticeFor decides for every warning kind", () => {
  // Typed as a Record over `WarningKind`, so adding a kind in `persistence.ts`
  // fails `yarn typecheck` right here. The underlying `switch` still ends in a
  // `return null`, which is why the exhaustiveness needs a guard of its own.
  const expected: Record<WarningKind, SaveNoticeKind | null> = {
    quota: "error",
    budget: "warn",
    unavailable: "error",
    future: "error",
    corrupt: null,
    unmigratable: null,
    repaired: null,
  };

  for (const kind of Object.keys(expected) as WarningKind[]) {
    const notice = imageSaveNoticeFor(warning(kind), false);
    assert.equal(notice === null ? null : notice.kind, expected[kind], kind);
  }

  assert.equal(imageSaveNoticeFor(null, false), null);
  assert.equal(imageSaveNoticeFor(null, true), null);
});

test("imageSaveNoticeFor overrides exactly one branch of saveNoticeFor", () => {
  const afterImage = imageSaveNoticeFor(warning("quota"), true);

  assert.equal(afterImage?.kind, "error");
  assert.match(afterImage?.text ?? "", /province image/);
  assert.notEqual(afterImage?.text, saveNoticeFor(warning("quota"), true)?.text);

  // Every other case is byte-identical to T09's table, so the warning-to-
  // sentence mapping has exactly one home.
  for (const kind of ["quota", "budget", "unavailable", "future", "corrupt"] as WarningKind[]) {
    assert.deepEqual(
      imageSaveNoticeFor(warning(kind), false),
      saveNoticeFor(warning(kind), false),
      kind,
    );
  }
  assert.deepEqual(imageSaveNoticeFor(warning("budget"), true), saveNoticeFor(warning("budget"), false));
});

test("the row sends every image through downscaleImage and resolves the quota now", () => {
  // None of this is reachable from Node and all of it is silent when removed.
  const source = readUiFile("ProvinceRow.tsx");

  assert.match(source, /maxEdge=\{PROVINCE_IMAGE_MAX_EDGE\}/);
  assert.doesNotMatch(source, /FileReader|toDataURL|createObjectURL/);
  assert.match(source, /flushState\(\)/, "an image write must resolve its quota outcome now");
  assert.match(source, /isImageDataUrl\(/, "the store rejects an over-cap data URL silently");
  // The list holds the only subscription; a row reads no signal, so it must not
  // reach the signals runtime at all.
  assert.doesNotMatch(source, /@preact\/signals-react/);
});

test("the list subscribes to the load phase and keys every row by the province id", () => {
  const source = readUiFile("ProvinceList.tsx");

  // `getMapAssets()` is a plain module variable and notifies nobody. Without
  // this read the names stay "Province N" for the whole session.
  assert.match(source, /loadPhase\.value/);
  // A sliding window must unmount the leaving id and mount the entering one, or
  // a buffered draft lands on the wrong province.
  assert.match(source, /key=\{row\.id\}/);
  assert.match(source, /useSignals\(\)/);
});

test("the panel keys the list by the country id", () => {
  // The key is what resets the query and the scroll on a country change, with
  // no effect and no cleanup.
  const source = readUiFile("ProvincesOverviewPanel.tsx");

  assert.match(source, /<ProvinceList\b/);
  assert.match(source, /key=\{country\.id\}/);
});

test("PROVINCE_ROW_HEIGHT is the single source of truth for the row height", () => {
  const rowSource = readUiFile("ProvinceRow.tsx");
  const css = readUiFile("province-list.module.css");

  assert.equal(PROVINCE_ROW_HEIGHT, 196);
  assert.match(rowSource, /style=\{\{ height: PROVINCE_ROW_HEIGHT \}\}/);

  // The CSS must not set a height on `.row`, or it could silently disagree with
  // the virtual-window arithmetic.
  const rowRule = /\n\.row \{([^}]*)\}/.exec(css);
  assert.ok(rowRule, ".row must exist in the module");
  assert.doesNotMatch(rowRule?.[1] ?? "", /height/);

  // A gap inside `.rows` adds height the geometry does not know about, and the
  // window then drifts away from the scrollbar.
  const rowsRule = /\n\.rows \{([^}]*)\}/.exec(css);
  assert.ok(rowsRule, ".rows must exist in the module");
  assert.doesNotMatch(rowsRule?.[1] ?? "", /gap/);
});

// ---------------------------------------------------------------------------
// Regression pass. Everything below was added by the tests agent; nothing above
// was edited beyond the two import lines these cases need.
// ---------------------------------------------------------------------------

// The panel's real viewport, measured in the browser check: 678 px, which gives
// `ceil(678 / 196) + 1 + 2 * 4 = 13` rendered rows.
const MEASURED_VIEWPORT = 678;

function cssRule(css: string, selector: string): string {
  const found = new RegExp("\\n\\" + selector + " \\{([^}]*)\\}").exec(css);
  assert.ok(found, selector + " must exist in the module");
  return found?.[1] ?? "";
}

function pxOf(declarations: string, property: string): number {
  const found = new RegExp(property + ":\\s*(\\d+)px").exec(declarations);
  assert.ok(found, property + " must be declared in px");
  return Number(found?.[1] ?? "0");
}

function windowFor(
  rowCount: number,
  viewportHeight: number,
  scrollTop: number,
  overscan = OVERSCAN_ROWS,
) {
  const first = windowStart(scrollTop, PROVINCE_ROW_HEIGHT, overscan, rowCount);
  return windowGeometry(first, viewportHeight, PROVINCE_ROW_HEIGHT, overscan, rowCount);
}

test("the rendered window covers every row the viewport can paint, at every scroll position", () => {
  // The off-by-one gate. `windowStart` and `windowGeometry` are called with two
  // different inputs — a pixel scroll and a stale integer — and a row the browser
  // is about to paint that falls outside [first, last) shows as a blank band.
  //
  // The sweep runs at overscan 0 as well as at `OVERSCAN_ROWS`. Four spare rows
  // on each side hide an off-by-one; at 0 the `+ 1` that covers a partially
  // scrolled row is load bearing and a missing row is exposed.
  for (const overscan of [0, OVERSCAN_ROWS]) {
    for (const rowCount of [1, 3, 13, 50, 400, 1648]) {
      for (const viewportHeight of [2 * PROVINCE_ROW_HEIGHT, 588, 600, MEASURED_VIEWPORT, 1000]) {
        const cap = Math.ceil(viewportHeight / PROVINCE_ROW_HEIGHT) + 1 + 2 * overscan;
        const maxScroll = Math.max(0, rowCount * PROVINCE_ROW_HEIGHT - viewportHeight);
        const stops = new Set<number>([0, maxScroll]);
        for (let at = 0; at <= maxScroll; at += 97) {
          stops.add(at);
        }
        for (let index = 0; index < rowCount; index += 1) {
          stops.add(Math.min(maxScroll, index * PROVINCE_ROW_HEIGHT));
          stops.add(Math.min(maxScroll, index * PROVINCE_ROW_HEIGHT + 1));
        }

        for (const scrollTop of stops) {
          const geometry = windowFor(rowCount, viewportHeight, scrollTop, overscan);
          const where =
            rowCount +
            " rows, viewport " +
            viewportHeight +
            ", scrollTop " +
            scrollTop +
            ", overscan " +
            overscan;
          const firstPainted = Math.min(rowCount - 1, Math.floor(scrollTop / PROVINCE_ROW_HEIGHT));
          const lastPainted = Math.min(
            rowCount - 1,
            Math.ceil((scrollTop + viewportHeight) / PROVINCE_ROW_HEIGHT) - 1,
          );

          assert.ok(geometry.first <= firstPainted, "window starts too late at " + where);
          assert.ok(geometry.last - 1 >= lastPainted, "window ends too early at " + where);
          assert.ok(geometry.last <= rowCount, "last past the end at " + where);
          assert.ok(geometry.last - geometry.first <= cap, "too many rows at " + where);
          assert.equal(geometry.offsetY, geometry.first * PROVINCE_ROW_HEIGHT, where);
          assert.equal(geometry.totalHeight, rowCount * PROVINCE_ROW_HEIGHT, where);
        }
      }
    }
  }
});

test("a scroll to the very bottom renders the last row and the measured 400-row numbers hold", () => {
  const rowCount = 400;
  const maxScroll = rowCount * PROVINCE_ROW_HEIGHT - MEASURED_VIEWPORT;
  const geometry = windowFor(rowCount, MEASURED_VIEWPORT, maxScroll);

  // The browser check measured 9 rows at the bottom with `first` at 391 of 400.
  assert.equal(geometry.first, 391);
  assert.equal(geometry.last, rowCount);
  assert.equal(geometry.last - geometry.first, 9);
  assert.equal(geometry.totalHeight, 78400);

  // And 13 rows everywhere else, which is the count the browser gate reads.
  assert.equal(windowFor(rowCount, MEASURED_VIEWPORT, 0).last, 13);
  const middle = windowFor(rowCount, MEASURED_VIEWPORT, 20000);
  assert.equal(middle.last - middle.first, 13);
});

test("a zero or non-finite viewport height still renders a window", () => {
  // The first frame runs before the `ResizeObserver` reports, so the height is 0.
  // Rendering nothing there would show an empty panel until the first resize.
  for (const height of [0, Number.NaN, Number.POSITIVE_INFINITY, -200]) {
    const geometry = windowGeometry(0, height, PROVINCE_ROW_HEIGHT, OVERSCAN_ROWS, 400);
    assert.ok(geometry.last - geometry.first >= 1, "height " + String(height) + " rendered nothing");
    assert.ok(geometry.last <= 400);
    assert.equal(geometry.totalHeight, 400 * PROVINCE_ROW_HEIGHT);
  }
});

test("a list shorter than the viewport renders every row and never scrolls", () => {
  const geometry = windowGeometry(0, 600, PROVINCE_ROW_HEIGHT, OVERSCAN_ROWS, 3);

  assert.equal(geometry.first, 0);
  assert.equal(geometry.last, 3);
  assert.equal(geometry.totalHeight, 3 * PROVINCE_ROW_HEIGHT);

  for (let index = 0; index < 3; index += 1) {
    assert.equal(scrollTopForIndex(index, 0, 600, PROVINCE_ROW_HEIGHT, 3), null, "index " + index);
  }
});

test("the map-to-list scroll lands the selected row inside the rendered window", () => {
  // The composite the sync effect actually runs: `scrollTopForIndex` writes
  // `el.scrollTop`, the `scroll` event feeds `windowStart`, and the render calls
  // `windowGeometry`. A row scrolled to but not rendered is a blank panel.
  const rowCount = 400;
  const cases = [
    { index: 349, scrollTop: 0 },
    { index: 0, scrollTop: 90 * PROVINCE_ROW_HEIGHT },
    { index: 399, scrollTop: 0 },
    { index: 12, scrollTop: 4 * PROVINCE_ROW_HEIGHT },
    { index: 4, scrollTop: 4 * PROVINCE_ROW_HEIGHT + 10 },
  ];

  for (const entry of cases) {
    const next = scrollTopForIndex(
      entry.index,
      entry.scrollTop,
      MEASURED_VIEWPORT,
      PROVINCE_ROW_HEIGHT,
      rowCount,
    );
    assert.notEqual(next, null, "index " + entry.index + " must move the scroll");
    const geometry = windowFor(rowCount, MEASURED_VIEWPORT, next ?? 0);
    assert.ok(
      geometry.first <= entry.index && entry.index < geometry.last,
      "index " + entry.index + " fell outside [" + geometry.first + ", " + geometry.last + ")",
    );
  }

  // The exact centred position the browser check measured for province 350.
  assert.equal(
    scrollTopForIndex(349, 0, MEASURED_VIEWPORT, PROVINCE_ROW_HEIGHT, rowCount),
    68163,
  );
});

test("filterRows is case- and whitespace-insensitive through normalizeQuery", () => {
  const rows = [row(1, { name: "Alta   Verde" }), row(2, { name: "Bela" })];

  const hit = filterRows(rows, normalizeQuery("   ALTA   verde  "));
  assert.equal(hit.length, 1);
  assert.equal(hit[0]?.id, 1);

  // A whitespace-only query normalizes to "" and must keep the list whole,
  // identity included — otherwise a stray space empties the panel.
  assert.equal(normalizeQuery("  \t\n "), "");
  assert.equal(filterRows(rows, normalizeQuery("  \t\n ")), rows);
});

test("the id rule is a prefix at every digit length", () => {
  const rows = [
    row(1, { name: "Ashen" }),
    row(13, { name: "Bela" }),
    row(21, { name: "Corvin" }),
    row(1318, { name: "Dorne", known: false }),
  ];

  const ids = (query: string) => {
    return filterRows(rows, query).map((entry) => {
      return entry.id;
    });
  };

  assert.deepEqual(ids("1"), [1, 13, 1318]);
  assert.deepEqual(ids("13"), [13, 1318]);
  assert.deepEqual(ids("1318"), [1318]);
  assert.deepEqual(ids("318"), []);
  assert.deepEqual(ids("8"), []);
  // A phantom row is searchable by both rules, or its override is unreachable.
  assert.deepEqual(ids("dorne"), [1318]);
});

test("matchesQuery ignores the lore and the stored image", () => {
  const stored = row(7, {
    name: "Ashen",
    lore: "the salt roads and a broken tower",
    imageDataUrl: "data:image/webp;base64,QUJD",
  });

  assert.equal(matchesQuery(stored, "salt"), false);
  assert.equal(matchesQuery(stored, "tower"), false);
  assert.equal(matchesQuery(stored, "webp"), false);
  assert.equal(matchesQuery(stored, "base64"), false);
  assert.equal(matchesQuery(stored, "ashen"), true);
});

test("buildProvinceRows keeps the given order and neither sorts nor dedupes", () => {
  // The row order is the country's assignment order. Sorting it would reshuffle
  // the list under the user on every paint stroke.
  const rows = buildProvinceRows([9, 4, 4, 1], lookups(new Map(), [1, 4, 9]));

  assert.deepEqual(
    rows.map((entry) => {
      return entry.id;
    }),
    [9, 4, 4, 1],
  );
  assert.deepEqual(buildProvinceRows([], lookups(new Map(), [])), []);
});

test("a stored override with no usable field still reads as edited and defaults everything", () => {
  // `writeOverrideField` deletes an emptied override, but a document written by
  // an older build or repaired on load can still hold a bare object. The row must
  // render, and its dot must show, or the override cannot be found and cleared.
  const overrides = new Map<number, ProvinceOverride>([
    [5, {}],
    [6, { name: "" }],
  ]);
  const rows = buildProvinceRows([5, 6], lookups(overrides, [5, 6]));

  assert.deepEqual(rows[0], {
    id: 5,
    name: "Manifest 5",
    rawName: "",
    lore: "",
    imageDataUrl: null,
    edited: true,
    known: true,
  });
  assert.equal(rows[1]?.rawName, "");
  assert.equal(rows[1]?.name, "Manifest 6");
  assert.equal(rows[1]?.edited, true);
});

test("buildProvinceRows asks the injected lookups once per id and layers nothing itself", () => {
  // The layering lives in `provinceDisplayName`. A second copy here would drift
  // away from the map labels and the plaque.
  const seen: number[] = [];
  const calls = { name: 0, override: 0, known: 0 };
  const rows = buildProvinceRows([2, 8], {
    displayNameOf: (id) => {
      calls.name += 1;
      seen.push(id);
      return "Injected " + id;
    },
    overrideOf: () => {
      calls.override += 1;
      return null;
    },
    isKnown: () => {
      calls.known += 1;
      return true;
    },
  });

  assert.deepEqual(seen, [2, 8]);
  assert.deepEqual(calls, { name: 2, override: 2, known: 2 });
  assert.equal(rows[0]?.name, "Injected 2");
  assert.equal(rows[1]?.name, "Injected 8");
});

test("overrideSummary is computed over the whole country, not the filtered view", () => {
  const rows = [
    row(1, { name: "Ashen", edited: true, imageDataUrl: "data:image/webp;base64,AA" }),
    row(2, { name: "Bela", edited: true }),
    row(3, { name: "Corvin" }),
  ];
  const visible = filterRows(rows, "corvin");

  assert.deepEqual(overrideSummary(rows), { edited: 2, withImage: 1 });
  // The footer prints `shown of total · edited`, and `edited` must not drop just
  // because a filter hides the edited rows.
  assert.deepEqual(overrideSummary(visible), { edited: 0, withImage: 0 });
  assert.notDeepEqual(overrideSummary(rows), overrideSummary(visible));
});

test("the stated storage budget arithmetic is the arithmetic the code runs", () => {
  // DESIGN section 9, tied to the real constants so a change to either fails here.
  assert.equal(utf16Bytes("x".repeat(24000)), PROVINCE_IMAGE_STORE_BYTES);
  assert.equal(imagesRemaining(0, STORAGE_BUDGET_BYTES, PROVINCE_IMAGE_STORE_BYTES), 83);
  // Worst case: `IMAGE_TARGET_BYTES` caps one image at 256 KB decoded, about
  // 700 KB stored, so five such images exhaust the budget.
  assert.equal(imagesRemaining(0, STORAGE_BUDGET_BYTES, 700 * 1024), 5);
  // An 8000-character lore is 16 KB stored, so about 250 full lores fill it too.
  assert.equal(utf16Bytes("x".repeat(LORE_MAX)), 16000);
  assert.equal(imagesRemaining(0, STORAGE_BUDGET_BYTES, LORE_MAX * 2), 250);
  // The exact edge: one image left, then none.
  assert.equal(
    imagesRemaining(
      STORAGE_BUDGET_BYTES - PROVINCE_IMAGE_STORE_BYTES,
      STORAGE_BUDGET_BYTES,
      PROVINCE_IMAGE_STORE_BYTES,
    ),
    1,
  );
  assert.equal(
    imagesRemaining(STORAGE_BUDGET_BYTES, STORAGE_BUDGET_BYTES, PROVINCE_IMAGE_STORE_BYTES),
    0,
  );
  assert.equal(imagesRemaining(Number.NaN, STORAGE_BUDGET_BYTES, PROVINCE_IMAGE_STORE_BYTES), 0);
});

test("budgetText never prints a fractional or negative count", () => {
  assert.equal(budgetText(2, 40), "2 images · room for about 40 more");
  assert.equal(budgetText(2.7, 40.9), "2 images · room for about 40 more");
  assert.equal(budgetText(-3, 10), "no images yet · room for about 10");
  assert.equal(budgetText(Number.NaN, Number.NaN), "no images yet · room for about 0");
  assert.equal(budgetText(1, 0), "1 image · room for about 0 more");
});

test("only the quota warning reacts to an image write", () => {
  // Typed over `WarningKind`, so a new kind in `persistence.ts` has to declare
  // here whether an image write changes its sentence.
  const imageSensitive: Record<WarningKind, boolean> = {
    quota: true,
    budget: false,
    unavailable: false,
    future: false,
    corrupt: false,
    unmigratable: false,
    repaired: false,
  };

  for (const kind of Object.keys(imageSensitive) as WarningKind[]) {
    const base = saveNoticeFor(warning(kind), false);
    const afterImage = imageSaveNoticeFor(warning(kind), true);
    if (imageSensitive[kind]) {
      assert.notDeepEqual(afterImage, base, kind);
      continue;
    }
    assert.deepEqual(afterImage, base, kind);
    assert.deepEqual(afterImage, imageSaveNoticeFor(warning(kind), false), kind);
  }
});

test("the image quota sentence names the image, keeps it on screen and never says flag", () => {
  const notice = imageSaveNoticeFor(warning("quota"), true);

  assert.equal(notice?.kind, "error");
  assert.match(notice?.text ?? "", /province image/);
  // The image stays rendered and persistence stays on — non-fatal, exactly as T09.
  assert.match(notice?.text ?? "", /still shown here/);
  assert.match(notice?.text ?? "", /the next change will save/);
  // T09's sentence for the same warning names the flag. Copying it here would
  // point the user at the wrong field.
  assert.doesNotMatch(notice?.text ?? "", /flag/);
  // `budget` is a warning, not an error: the data did reach the disk.
  assert.equal(imageSaveNoticeFor(warning("budget"), true)?.kind, "warn");
});

test("the row's constants stay the ones the layout and the store were sized for", () => {
  assert.equal(OVERSCAN_ROWS, 4);
  assert.equal(PROVINCE_LORE_ROWS, 3);
  // T09 moved the flag to 384 and left this at 320 on purpose: raising it
  // multiplies the stored size by the square of the ratio for a 96 px preview.
  assert.equal(PROVINCE_IMAGE_MAX_EDGE, 320);
});

test("the name field is controlled on the raw override so clearing it restores the manifest name", () => {
  const source = readUiFile("ProvinceRow.tsx");

  // `value` must be the raw override and the resolved name only the placeholder.
  // Controlling the input on the resolved name makes the field impossible to
  // clear, and clearing it is how a province returns to its manifest name.
  assert.match(source, /value=\{row\.rawName\}/);
  assert.match(source, /placeholder=\{row\.name\}/);
  assert.match(source, /setProvinceName\(row\.id, value\)/);
  assert.match(source, /setProvinceLore\(row\.id, value\)/);
  assert.match(source, /setProvinceImage\(row\.id, dataUrl\)/);
  // The browser check's row selector.
  assert.match(source, /data-province-row/);
  // The sparseness rule: no setter may be reachable from render, only from a
  // commit handler. A `useEffect` in a row is the shape that would break it.
  assert.doesNotMatch(source, /useEffect|useSignalEffect/);
});

test("the lore box is capped and cannot resize the fixed row", () => {
  const source = readUiFile("ProvinceRow.tsx");
  const css = readUiFile("province-list.module.css");
  const area = cssRule(css, ".rowArea");

  assert.match(source, /areaClassName=\{styles\.rowArea\}/);
  assert.match(source, /rows=\{PROVINCE_LORE_ROWS\}/);
  assert.match(source, /maxLength=\{LORE_MAX\}/);
  assert.match(source, /maxLength=\{NAME_MAX\}/);

  // `fields.module.css`'s `.area` sets `min-height: 6em` and `resize: vertical`,
  // and either one breaks a fixed row height.
  assert.match(area, /min-height:\s*0/);
  assert.match(area, /resize:\s*none/);
  assert.doesNotMatch(area, /resize:\s*vertical/);
  assert.doesNotMatch(area, /min-height:\s*6em/);
});

test("areaClassName REPLACES the shared area class instead of appending to it", () => {
  // Two single-class selectors from two CSS modules have equal specificity, so an
  // appended class wins or loses on rspack's emit order.
  const source = readUiFile("EditableTextArea.tsx");

  assert.match(source, /className=\{props\.areaClassName \?\? styles\.area\}/);
  assert.doesNotMatch(source, /className=\{`/);
  assert.doesNotMatch(source, /styles\.area \+/);
  // The other two callers pass no `areaClassName` and must keep the old look.
  assert.match(source, /rows \?\? DEFAULT_ROWS/);
});

test("the footer counts the country while the window shows the filter", () => {
  const source = readUiFile("ProvinceList.tsx");

  assert.match(source, /overrideSummary\(rows\)/);
  assert.match(source, /filterRows\(rows, normalized\)/);
  assert.match(source, /normalizeQuery\(query\)/);
  assert.match(source, /props\.footer\(visible\.length, summary\)/);
  // The window is sliced out of the filtered rows, never mapped over all of them.
  assert.match(source, /visible\.slice\(geometry\.first, geometry\.last\)/);
  assert.doesNotMatch(source, /provinceIds\.map\(/);
});

test("the scroll viewport stays mounted, so its ResizeObserver survives an empty filter", () => {
  const source = readUiFile("ProvinceList.tsx");

  // Unmounting the viewport for the "no match" line would drop the observer
  // registered against that element in a `[]`-dependency effect, and the measured
  // height would stay stale for the rest of the session.
  assert.ok(
    source.indexOf("styles.viewport") < source.indexOf("visible.length === 0"),
    "the empty line must render INSIDE the viewport",
  );
  assert.match(source, /new ResizeObserver\(/);
  assert.match(source, /observer\.disconnect\(\)/);
  // A plain `useEffect`: the signal is read in the render body and arrives here
  // as a dependency. No action may run inside a signal effect.
  assert.doesNotMatch(source, /useSignalEffect/);
});

test("the viewport is the scroller and every sibling inside the list is flex: none", () => {
  const css = readUiFile("province-list.module.css");
  const viewport = cssRule(css, ".viewport");

  // `Panel`'s `.body` is already a flex column with `min-height: 0`, so this
  // child becomes the scroller and the panel body itself never scrolls.
  assert.match(viewport, /flex:\s*1/);
  assert.match(viewport, /min-height:\s*0/);
  assert.match(viewport, /overflow-y:\s*auto/);
  assert.match(viewport, /position:\s*relative/);

  for (const selector of [".search", ".note", ".filtered", ".notice"]) {
    assert.match(cssRule(css, selector), /flex:\s*none/, selector + " must not stretch");
  }

  // The window is absolute, so it adds nothing to the spacer's height, and the
  // spacer's height is inline from the row count.
  const windowRule = cssRule(css, ".window");
  assert.match(windowRule, /position:\s*absolute/);
  assert.match(windowRule, /top:\s*0/);
  assert.doesNotMatch(cssRule(css, ".spacer"), /height/);
});

test("the fixed pixel heights inside a row fit PROVINCE_ROW_HEIGHT", () => {
  // The row clips its overflow, so a preview or a header that grows past the
  // budget silently cuts the fields off instead of failing loudly.
  const css = readUiFile("province-list.module.css");
  const theme = readUiFile("theme.css");
  const rowRule = cssRule(css, ".row");

  const space3 = pxOf(theme, "--civ-space-3");
  assert.match(rowRule, /padding:\s*var\(--civ-space-3\)/);
  assert.match(rowRule, /gap:\s*var\(--civ-space-3\)/);
  assert.match(rowRule, /border:\s*1px/);
  assert.match(rowRule, /overflow:\s*hidden/);

  const head = pxOf(cssRule(css, ".rowHead"), "height");
  const preview = pxOf(cssRule(css, ".rowPreview"), "height");
  const fixed = 2 + 2 * space3 + head + space3 + preview;

  assert.equal(head, 24);
  assert.equal(preview, 72);
  assert.ok(fixed <= PROVINCE_ROW_HEIGHT, fixed + "px of fixed height in a " + PROVINCE_ROW_HEIGHT + "px row");
});

test("the panel dropped its ROW_CAP and tags the notice with the province it came from", () => {
  const source = readUiFile("ProvincesOverviewPanel.tsx");

  // T10 replaced the truncated placeholder list with the virtualiser. A cap
  // surviving here would silently hide provinces again.
  assert.doesNotMatch(source, /ROW_CAP/);
  assert.doesNotMatch(source, /panel-bodies/);
  assert.doesNotMatch(source, /slice\(/);
  // The panel does not remount when the selection moves, so a notice raised for
  // another country's province must be filtered out by membership.
  assert.match(source, /provinceIds\.includes\(notice\.provinceId\)/);
  assert.match(
    source,
    /imagesRemaining\(used, STORAGE_BUDGET_BYTES, PROVINCE_IMAGE_STORE_BYTES\)/,
  );
  // The notice renders at panel level, above the list, never inside a row.
  assert.ok(
    source.indexOf("styles.notice") < source.indexOf("<ProvinceList"),
    "the save notice must render above the list",
  );
});
