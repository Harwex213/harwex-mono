import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { LORE_MAX } from "../state/schema";
import {
  LORE_COUNTER_AT,
  formatArea,
  formatBytes,
  formatProvinceCount,
  groupDigits,
  loreCounterText,
  saveNoticeFor,
} from "./country-overview";
import { dataUrlBytes } from "../state/image";
import type { SaveNoticeKind } from "./country-overview";
import type { StateWarning, WarningKind } from "../state/persistence";

// The country panel's pure half. The `.tsx` itself is untestable — there is no
// jsdom in this repo — which is exactly why this logic was moved out of it.

function warning(kind: WarningKind, message = "the message"): StateWarning {
  return { kind, message, at: 0 };
}

test("groupDigits inserts a comma every three digits and never a leading one", () => {
  assert.equal(groupDigits(0), "0");
  assert.equal(groupDigits(7), "7");
  assert.equal(groupDigits(999), "999");
  assert.equal(groupDigits(1000), "1,000");
  assert.equal(groupDigits(18687), "18,687");
  assert.equal(groupDigits(2756578), "2,756,578");
});

test("groupDigits floors a fraction and refuses a negative or a NaN", () => {
  assert.equal(groupDigits(1234.9), "1,234");
  assert.equal(groupDigits(-5), "0");
  assert.equal(groupDigits(Number.NaN), "0");
  assert.equal(groupDigits(Number.POSITIVE_INFINITY), "0");
});

test("formatArea matches the units the country list already prints", () => {
  // `CountryPanel`'s row reads "18,687 px". Two spellings of one number in one
  // app is a bug report waiting to happen.
  assert.equal(formatArea(18687), "18,687 px");
  assert.equal(formatArea(0), "0 px");
});

test("formatProvinceCount pluralises on the count, not on a truthiness check", () => {
  assert.equal(formatProvinceCount(0), "0 provinces");
  assert.equal(formatProvinceCount(1), "1 province");
  assert.equal(formatProvinceCount(2), "2 provinces");
  assert.equal(formatProvinceCount(1648), "1,648 provinces");
  assert.equal(formatProvinceCount(Number.NaN), "0 provinces");
});

test("formatBytes rounds to KB and never prints an empty-looking 0 for real data", () => {
  assert.equal(formatBytes(0), "0 KB");
  assert.equal(formatBytes(-1), "0 KB");
  // A one-byte image is still "1 KB": rounding it to 0 would read as "not saved".
  assert.equal(formatBytes(1), "1 KB");
  assert.equal(formatBytes(13312), "13 KB");
  assert.equal(formatBytes(262144), "256 KB");
});

test("loreCounterText stays silent until the last tenth of the cap", () => {
  const max = 8000;
  const threshold = Math.floor(max * LORE_COUNTER_AT);

  assert.equal(loreCounterText(0, max), null);
  assert.equal(loreCounterText(threshold - 1, max), null);
  assert.equal(loreCounterText(threshold, max), "800 characters left");
  assert.equal(loreCounterText(max - 1, max), "1 characters left");
  assert.equal(loreCounterText(max, max), "the lore is full at 8,000 characters");
  // Over the cap cannot happen through the field, but it must not print a
  // negative if it ever does.
  assert.equal(loreCounterText(max + 50, max), "the lore is full at 8,000 characters");
});

test("loreCounterText refuses a zero or negative cap instead of dividing into it", () => {
  assert.equal(loreCounterText(10, 0), null);
  assert.equal(loreCounterText(10, -1), null);
});

test("saveNoticeFor says nothing when there is no warning", () => {
  assert.equal(saveNoticeFor(null, false), null);
  assert.equal(saveNoticeFor(null, true), null);
});

test("a quota failure after a flag upload names the flag and says it is still shown", () => {
  const notice = saveNoticeFor(warning("quota"), true);
  assert.ok(notice);
  assert.equal(notice.kind, "error");
  assert.match(notice.text, /flag/);
  assert.match(notice.text, /still/);
});

test("a quota failure from a keystroke does not blame the flag", () => {
  const notice = saveNoticeFor(warning("quota"), false);
  assert.ok(notice);
  assert.equal(notice.kind, "error");
  assert.match(notice.text, /storage is full/);
  assert.doesNotMatch(notice.text, /the flag was not saved/);
});

test("a budget warning is a warn, and carries the store's own KB figure through", () => {
  const message = "the saved state is 3906 KB and is close to the browser limit";
  for (const afterFlagWrite of [false, true]) {
    const notice = saveNoticeFor(warning("budget", message), afterFlagWrite);
    assert.ok(notice);
    assert.equal(notice.kind, "warn");
    assert.equal(notice.text, message);
  }
});

test("an unavailable storage and a future document are both errors", () => {
  const unavailable = saveNoticeFor(warning("unavailable", "cookies are blocked"), false);
  assert.ok(unavailable);
  assert.equal(unavailable.kind, "error");
  assert.match(unavailable.text, /cookies are blocked/);

  const future = saveNoticeFor(warning("future"), false);
  assert.ok(future);
  assert.equal(future.kind, "error");
  assert.match(future.text, /newer build/);
});

test("the three load-time warnings stay in the top banner and not in the panel", () => {
  // `corrupt`, `unmigratable` and `repaired` describe the document as a whole,
  // `App.tsx` already renders them with a dismiss control, and the panel cannot
  // fix any of them.
  for (const kind of ["corrupt", "unmigratable", "repaired"] as const) {
    assert.equal(saveNoticeFor(warning(kind), false), null, kind);
    assert.equal(saveNoticeFor(warning(kind), true), null, kind);
  }
});

test("saveNoticeFor decides for every kind the store can raise, both before and after a flag", () => {
  // The table is typed `Record<WarningKind, …>`, so a new `WarningKind` in
  // `persistence.ts` fails `yarn typecheck` HERE. That is the point: the switch
  // in `saveNoticeFor` has no catch-all, so a new kind would silently fall
  // through to `null` and the panel would go quiet about a real failure.
  const expected: Record<WarningKind, SaveNoticeKind | null> = {
    budget: "warn",
    corrupt: null,
    future: "error",
    quota: "error",
    repaired: null,
    unavailable: "error",
    unmigratable: null,
  };

  for (const [kind, kindOfNotice] of Object.entries(expected) as [
    WarningKind,
    SaveNoticeKind | null,
  ][]) {
    for (const afterFlagWrite of [false, true]) {
      const notice = saveNoticeFor(warning(kind), afterFlagWrite);
      if (kindOfNotice === null) {
        assert.equal(notice, null, kind);
        continue;
      }
      assert.ok(notice, kind);
      assert.equal(notice.kind, kindOfNotice, kind);
      assert.notEqual(notice.text.trim(), "", kind + " must say something");
    }
  }

  // Only `quota` reads differently depending on what caused the write, because
  // only a flag can be removed to make room.
  const afterFlag = saveNoticeFor(warning("quota"), true);
  const afterKeystroke = saveNoticeFor(warning("quota"), false);
  assert.ok(afterFlag);
  assert.ok(afterKeystroke);
  assert.notEqual(afterFlag.text, afterKeystroke.text);
});

test("the flag fact is formatBytes over dataUrlBytes, the pair the panel composes", () => {
  // `CountryOverviewPanel` prints `formatBytes(dataUrlBytes(flagDataUrl))`. The
  // two are tested apart above; this pins the composition, which is the number a
  // user compares against the quota notice.
  const tiny = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=";
  assert.equal(dataUrlBytes(tiny), 38);
  // Under a kilobyte still reads "1 KB": a flag that is on screen must never
  // report "0 KB", which reads as "not saved".
  assert.equal(formatBytes(dataUrlBytes(tiny)), "1 KB");

  // The T05 measured data point, re-encoded at FLAG_MAX_EDGE 384: ~35 000 base64
  // characters of WebP.
  const measured = "data:image/webp;base64," + "A".repeat(35359);
  assert.equal(formatBytes(dataUrlBytes(measured)), "26 KB");

  // A URL the store would refuse is still measurable — the fact renders from
  // whatever is in the document, never from what was picked.
  assert.equal(formatBytes(dataUrlBytes("not a data url")), "0 KB");
});

test("the lore counter is tied to the schema cap, not to a copy of 8000", () => {
  // If `LORE_MAX` ever moves, the counter has to move with it. The panel passes
  // the schema constant, so the threshold arithmetic is checked against it.
  const threshold = Math.floor(LORE_MAX * LORE_COUNTER_AT);

  assert.equal(LORE_MAX, 8000);
  assert.equal(threshold, 7200);
  assert.equal(loreCounterText(threshold - 1, LORE_MAX), null);
  assert.equal(loreCounterText(threshold, LORE_MAX), "800 characters left");
  assert.match(loreCounterText(LORE_MAX, LORE_MAX) ?? "", /8,000/);
});

test("the area fact holds at the largest pixel count the map can produce", () => {
  // `provinces_map.png` is 3653 x 2855, so no country's area can exceed
  // 10,429,315 px. The grouping has to survive eight digits without a stray
  // leading comma.
  assert.equal(formatArea(3653 * 2855), "10,429,315 px");
  assert.equal(groupDigits(100), "100");
  assert.equal(groupDigits(1000000), "1,000,000");
});

test("the panel resolves a flag write now and reads the store back to catch a silent drop", () => {
  // Neither can be reached from Node — there is no jsdom — and both are silent
  // when removed: without `flushState()` a quota failure arrives 400 ms after the
  // upload, and without the `.peek()` read-back an over-cap data URL is shown as
  // a flag that was never stored. A source check is the only guard available.
  const panel = readFileSync(
    fileURLToPath(new URL("./CountryOverviewPanel.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(panel, /flushState\(\)/, "a flag write must resolve its quota outcome now");
  assert.match(panel, /countryById\.peek\(\)/, "the read-back detects a silently dropped flag");
  assert.doesNotMatch(panel, /countryById\.value/, "an event handler must not subscribe");

  // `downscaleImage` inside `ImageUpload` is the only encoder, and the panel
  // hands it the flag cap rather than a number of its own.
  assert.match(panel, /maxEdge=\{FLAG_MAX_EDGE\}/);
  assert.doesNotMatch(panel, /FileReader|toDataURL|createObjectURL/);

  // Every field is keyed by the country id, so a pending draft or an in-flight
  // upload cannot land on the country the user switched to.
  for (const field of ["flag", "name", "slogan", "lore"]) {
    assert.match(panel, new RegExp('key=\\{"' + field + '-" \\+ country\\.id\\}'), field);
  }
});
