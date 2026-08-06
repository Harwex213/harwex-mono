import { saveNoticeFor } from "./country-overview";
import type { ProvinceOverride } from "../state/schema";
import type { SaveNotice } from "./country-overview";
import type { StateWarning } from "../state/persistence";

// The provinces panel's pure half: the virtual-window arithmetic, the search
// predicate, the row assembly, the override summary, the image budget and the
// quota notice. The same split T07 used for `label-layout.ts`, T08 for
// `nextSelection` and T09 for `country-overview.ts`.
//
// No React, no signals, no DOM. The repo has no jsdom, so a `.tsx` cannot be
// unit tested — everything in this panel worth an assertion lives here.

// The row is 196 CSS px and THIS CONSTANT IS THE SINGLE SOURCE OF TRUTH: the
// row element takes `style={{ height: PROVINCE_ROW_HEIGHT }}` and the CSS module
// sets no height at all. The internal budget, which is what fixes the number:
//   2 px border + 8 px padding top + 8 px padding bottom      = 18
//   header select strip                                       = 24
//   gap                                                       =  8
//   body, the taller of the two columns                       = 144
//     left  (ImageUpload): caption 14 + 4 + preview 72 + 8 + actions 26 = 124
//     right (two fields):  caption 14 + 4 + input 30 + 12
//                          + caption 14 + 4 + textarea 66              = 144
const PROVINCE_ROW_HEIGHT = 196;

// Four rows above and four below. Generous on purpose: a row unmounting under a
// fast scroll aborts an in-flight `downscaleImage` in that row.
const OVERSCAN_ROWS = 4;

// The lore box inside a row. The full 8000-character cap still applies; the box
// scrolls internally and does not resize, because a resizable box would break
// the fixed row height.
const PROVINCE_LORE_ROWS = 3;

// One 320-edge WebP costs roughly this many BYTES OF localStorage. localStorage
// is accounted in UTF-16 code units, so a base64 character costs 2 bytes: a
// 320-edge re-encode is about 24 000 characters, hence ~48 KB. Against
// `STORAGE_BUDGET_BYTES` of 4 000 000 that is about 80 province images.
const PROVINCE_IMAGE_STORE_BYTES = 48000;

const WHITESPACE_RUN = /\s+/g;

type ProvinceRow = {
  id: number;
  // The layered display name: override -> manifest -> "Province N".
  name: string;
  // The RAW override value, "" when the province has none. The name input is
  // controlled on this, not on `name`, so an empty field can be typed into.
  rawName: string;
  lore: string;
  imageDataUrl: string | null;
  // True when the province has any stored override at all. Drives the row's
  // "edited" dot, which is the browser-visible instrument for sparseness.
  edited: boolean;
  // False for an id the manifest does not carry (ids 1318 and 1458 are absent,
  // and a stored document may name others). Such a row is still listed and
  // still editable; hiding it would make its override unreachable.
  known: boolean;
};

type ProvinceLookups = {
  displayNameOf: (id: number) => string;
  overrideOf: (id: number) => ProvinceOverride | null;
  isKnown: (id: number) => boolean;
};

type ListGeometry = {
  first: number;
  // EXCLUSIVE.
  last: number;
  offsetY: number;
  totalHeight: number;
};

type OverrideSummary = {
  edited: number;
  withImage: number;
};

// Lifted out of the row so the sentence renders at the top of the panel body
// rather than under one province's file picker — the rule T09 set for the flag.
type ImageNotice = {
  provinceId: number;
  rejected: boolean;
  touched: boolean;
};

function clamp(value: number, low: number, high: number): number {
  if (value < low) {
    return low;
  }
  if (value > high) {
    return high;
  }
  return value;
}

// The index the window starts at for a scroll position, overscan applied and
// clamped. Its integer result is the component's only scroll state, so scrolling
// WITHIN one row costs zero React renders.
function windowStart(
  scrollTop: number,
  rowHeight: number,
  overscan: number,
  rowCount: number,
): number {
  if (rowCount <= 0 || !Number.isFinite(scrollTop) || rowHeight <= 0) {
    return 0;
  }
  const raw = Math.floor(Math.max(0, scrollTop) / rowHeight);
  return clamp(raw - overscan, 0, rowCount - 1);
}

// The window that starts at `first`. It RE-CLAMPS `first`, so a stale state
// value left over from a longer list can never render past the end.
function windowGeometry(
  first: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
  rowCount: number,
): ListGeometry {
  if (rowCount <= 0 || rowHeight <= 0) {
    return { first: 0, last: 0, offsetY: 0, totalHeight: 0 };
  }

  const totalHeight = rowCount * rowHeight;
  const height = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  // The `+ 1` covers a partially scrolled first row.
  const visible = Math.max(1, Math.ceil(height / rowHeight) + 1);
  // Exactly the `first` a legitimate scroll to the bottom produces, so clamping
  // to it never fights a real scroll position — and it is what removes the blank
  // frame between a filter shrinking the list and the browser's own `scrollTop`
  // clamp firing a `scroll` event.
  const maxFirst = Math.max(0, rowCount - visible - overscan);
  const start = clamp(Number.isFinite(first) ? Math.floor(first) : 0, 0, maxFirst);
  const last = Math.min(rowCount, start + visible + 2 * overscan);

  return { first: start, last, offsetY: start * rowHeight, totalHeight };
}

// The scrollTop that brings `index` fully into view, or null when it already is.
// `null` means "do not touch the scroll position" — which is also what makes a
// click on a visible row not jump the list under the user's cursor.
function scrollTopForIndex(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  rowCount: number,
): number | null {
  if (!Number.isFinite(index) || !Number.isFinite(scrollTop) || !Number.isFinite(viewportHeight)) {
    return null;
  }
  if (rowHeight <= 0 || index < 0 || index >= rowCount) {
    return null;
  }

  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top >= scrollTop && bottom <= scrollTop + viewportHeight) {
    return null;
  }

  const maxScroll = Math.max(0, rowCount * rowHeight - viewportHeight);
  // A jump of more than one viewport CENTRES the row: it reads as "the list
  // revealed the row" rather than "the row is glued to an edge".
  if (Math.abs(top - scrollTop) > viewportHeight) {
    return clamp(top - (viewportHeight - rowHeight) / 2, 0, maxScroll);
  }
  if (top < scrollTop) {
    return clamp(top, 0, maxScroll);
  }
  return clamp(bottom - viewportHeight, 0, maxScroll);
}

function normalizeQuery(text: string): string {
  if (typeof text !== "string") {
    return "";
  }
  return text.trim().toLowerCase().replace(WHITESPACE_RUN, " ");
}

// The id match is a PREFIX, not a substring: typing `41` should surface province
// 41 and 412, not every province whose id happens to contain those digits. The
// lore is deliberately NOT searched — it is up to 8000 characters per province,
// and a name-plus-id match is predictable where a full-text match over prose is
// not.
function matchesQuery(row: ProvinceRow, query: string): boolean {
  if (query === "") {
    return true;
  }
  if (normalizeQuery(row.name).includes(query)) {
    return true;
  }
  return String(row.id).startsWith(query);
}

// Returns the SAME array reference when the query is empty. That identity feeds
// the `useMemo` chain in `ProvinceList` and keeps an unfiltered list free.
function filterRows(rows: readonly ProvinceRow[], query: string): readonly ProvinceRow[] {
  if (query === "") {
    return rows;
  }
  return rows.filter((row) => {
    return matchesQuery(row, query);
  });
}

function indexOfProvince(rows: readonly ProvinceRow[], id: number | null): number {
  if (id === null) {
    return -1;
  }
  return rows.findIndex((row) => {
    return row.id === id;
  });
}

// The name layering lives in `provinceDisplayName` in `world-store.ts` and is
// INJECTED, never re-implemented.
function buildProvinceRows(
  ids: readonly number[],
  lookups: ProvinceLookups,
): ProvinceRow[] {
  const out: ProvinceRow[] = [];
  for (const id of ids) {
    const override = lookups.overrideOf(id);
    out.push({
      id,
      name: lookups.displayNameOf(id),
      rawName: override?.name ?? "",
      lore: override?.lore ?? "",
      imageDataUrl: override?.imageDataUrl ?? null,
      edited: override !== null,
      known: lookups.isKnown(id),
    });
  }
  return out;
}

// The in-app instrument for "only touched provinces are persisted": open a
// 300-province country, scroll the whole list, and the footer must still read
// `0 edited`.
function overrideSummary(rows: readonly ProvinceRow[]): OverrideSummary {
  let edited = 0;
  let withImage = 0;
  for (const row of rows) {
    if (row.edited) {
      edited += 1;
    }
    if (row.imageDataUrl !== null) {
      withImage += 1;
    }
  }
  return { edited, withImage };
}

// Floors at 0. Never negative, so a document already over budget reads "0 more".
function imagesRemaining(
  usedBytes: number,
  budgetBytes: number,
  bytesPerImage: number,
): number {
  if (!Number.isFinite(usedBytes) || !Number.isFinite(budgetBytes)) {
    return 0;
  }
  if (!Number.isFinite(bytesPerImage) || bytesPerImage <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor((budgetBytes - usedBytes) / bytesPerImage));
}

function budgetText(withImage: number, remaining: number): string {
  const count = Number.isFinite(withImage) ? Math.max(0, Math.trunc(withImage)) : 0;
  const left = Number.isFinite(remaining) ? Math.max(0, Math.trunc(remaining)) : 0;
  if (count === 0) {
    return "no images yet · room for about " + left;
  }
  return count + (count === 1 ? " image" : " images") + " · room for about " + left + " more";
}

// DELEGATES to T09's `saveNoticeFor` for every warning kind and overrides one
// branch only. The warning-to-sentence table then stays in one place, so a new
// `WarningKind` still has exactly one place to be handled.
function imageSaveNoticeFor(
  warning: StateWarning | null,
  afterImageWrite: boolean,
): SaveNotice | null {
  if (warning !== null && warning.kind === "quota" && afterImageWrite) {
    return {
      kind: "error",
      text:
        "storage is full, so that province image was not saved. it is still shown here; " +
        "remove it or another image, and the next change will save.",
    };
  }
  return saveNoticeFor(warning, false);
}

export {
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
  type ImageNotice,
  type ListGeometry,
  type OverrideSummary,
  type ProvinceLookups,
  type ProvinceRow,
};
