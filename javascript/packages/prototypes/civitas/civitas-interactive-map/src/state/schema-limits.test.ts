import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_COUNTRY_COLORS,
  IMAGE_DATA_URL_MAX,
  LORE_MAX,
  MAX_COUNTRY_ID,
  MAX_JSON_DEPTH,
  NAME_MAX,
  SLOGAN_MAX,
  clampText,
  createCountry,
  createEmptyState,
  defaultCountryColor,
  isImageDataUrl,
  normalizeState,
  sanitizeJson,
  serializeState,
} from "./schema";
import type { JsonRecord } from "./schema";

// The boundaries `schema.test.ts` states in prose but does not pin: the exact
// character at which a cap bites, the exact nesting level at which the depth
// budget runs out, and the ids the manifest does not carry.

// `levels` nested objects wrapped around `inner`, so a depth assertion can name
// the surviving level count instead of grepping the stringified result.
function wrap(levels: number, inner: unknown): unknown {
  let current = inner;
  for (let at = 0; at < levels; at += 1) {
    current = { n: current };
  }
  return current;
}

test("the default palette cycles every 16 ids and answers even a hostile one", () => {
  assert.equal(DEFAULT_COUNTRY_COLORS.length, 16);
  assert.equal(defaultCountryColor(1), DEFAULT_COUNTRY_COLORS[0]);
  assert.equal(defaultCountryColor(16), DEFAULT_COUNTRY_COLORS[15]);
  // A 17th country must get a colour, not `undefined` painted onto the map.
  assert.equal(defaultCountryColor(17), DEFAULT_COUNTRY_COLORS[0]);
  assert.equal(
    defaultCountryColor(MAX_COUNTRY_ID),
    DEFAULT_COUNTRY_COLORS[(MAX_COUNTRY_ID - 1) % DEFAULT_COUNTRY_COLORS.length],
  );

  // The `Math.abs` guard: a hostile id must not index the palette negatively.
  for (const id of [0, -5, -1, 1.7, -0.5]) {
    assert.match(defaultCountryColor(id), /^#[0-9a-f]{6}$/, "id " + id + " produced no colour");
  }
});

test("createCountry names an unnamed country and clamps an over-long one", () => {
  assert.equal(createCountry(3).name, "Country 3");
  // An empty name is "no name given", not a name of zero characters.
  assert.equal(createCountry(3, "").name, "Country 3");

  const country = createCountry(3, "x".repeat(NAME_MAX + 50));
  assert.equal(country.name.length, NAME_MAX);
  assert.equal(country.slogan, "");
  assert.equal(country.lore, "");
  assert.equal(country.flagDataUrl, null);
  assert.deepEqual(country.provinceIds, []);
  assert.equal(country.colorHex, defaultCountryColor(3));
});

test("clampText cuts one character past the cap and leaves the cap itself alone", () => {
  const exact = "y".repeat(NAME_MAX);
  assert.equal(clampText(exact, NAME_MAX), exact);
  assert.equal(clampText(exact + "z", NAME_MAX).length, NAME_MAX);
  assert.equal(clampText("", NAME_MAX), "");
});

test("a data URL is accepted at exactly the cap and refused one character over", () => {
  const head = "data:image/webp;base64,";
  const atCap = head + "A".repeat(IMAGE_DATA_URL_MAX - head.length);

  assert.equal(atCap.length, IMAGE_DATA_URL_MAX);
  assert.equal(isImageDataUrl(atCap), true);
  assert.equal(isImageDataUrl(atCap + "A"), false);
  assert.equal(isImageDataUrl(""), false);
  // Only an image may enter the document. The app has no backend, so a remote
  // URL is corruption or an injection attempt.
  assert.equal(isImageDataUrl("data:text/html;base64,AAAA"), false);
  assert.equal(isImageDataUrl("http://example.test/flag.png"), false);
  assert.equal(isImageDataUrl(null), false);
  assert.equal(isImageDataUrl(7), false);
});

test("a country slogan and lore are capped on load, not just a province's", () => {
  const result = normalizeState({
    version: 1,
    countries: [
      {
        id: 1,
        name: "n".repeat(NAME_MAX + 40),
        slogan: "s".repeat(SLOGAN_MAX + 40),
        lore: "l".repeat(LORE_MAX + 40),
      },
    ],
  });

  const country = result.state.countries[0];
  assert.equal(country?.name.length, NAME_MAX);
  assert.equal(country?.slogan.length, SLOGAN_MAX);
  assert.equal(country?.lore.length, LORE_MAX);
});

test("a hostile nextCountryId is clamped to one past the Uint16 ceiling", () => {
  // A country id indexes a Uint16Array in `buildCountryOf`, so a stored
  // nextCountryId of 9e15 would allocate an id that silently truncates.
  const huge = normalizeState({
    version: 1,
    provinceOverrides: {},
    countries: [],
    economics: {},
    nextCountryId: 9e15,
  });
  assert.equal(huge.state.nextCountryId, MAX_COUNTRY_ID + 1);

  const negative = normalizeState({ version: 1, countries: [], nextCountryId: -3 });
  assert.equal(negative.state.nextCountryId, 1);

  const fractional = normalizeState({ version: 1, countries: [], nextCountryId: 4.5 });
  assert.equal(fractional.state.nextCountryId, 1);
});

test("sanitizeJson carries exactly MAX_JSON_DEPTH object levels and drops the next", () => {
  assert.equal(MAX_JSON_DEPTH, 8);

  // Eight object levels with a string at the bottom survive untouched.
  assert.deepEqual(
    sanitizeJson(wrap(MAX_JSON_DEPTH, "leaf"), MAX_JSON_DEPTH),
    wrap(MAX_JSON_DEPTH, "leaf"),
  );

  // The ninth level is past the budget, so the eighth is left empty. Off by one
  // in either direction changes this shape.
  assert.deepEqual(
    sanitizeJson(wrap(MAX_JSON_DEPTH + 1, "leaf"), MAX_JSON_DEPTH),
    wrap(MAX_JSON_DEPTH - 1, {}),
  );

  // A primitive is checked before the depth budget, so it survives at depth 0
  // while an object at the same depth does not.
  assert.equal(sanitizeJson("x", 0), "x");
  assert.equal(sanitizeJson(0, 0), 0);
  assert.equal(sanitizeJson(null, 0), null);
  assert.equal(sanitizeJson({}, 0), undefined);
  assert.equal(sanitizeJson([], 0), undefined);
});

test("serializeState sanitises economics, so no unserialisable value reaches the document", () => {
  const state = createEmptyState();
  state.countries.push(createCountry(1, "Testland"));
  state.economics.set(1, {
    version: 3,
    data: {
      note: "kept",
      gdp: Number.NaN,
      debt: Number.POSITIVE_INFINITY,
      floor: Number.NEGATIVE_INFINITY,
      list: [1, Number.NaN, 2],
      deep: wrap(MAX_JSON_DEPTH + 4, "lost"),
    } as unknown as JsonRecord,
  });

  const doc = serializeState(state);
  const slot = doc.economics["1"];

  // The slot version is the economics data version, not the schema version.
  assert.equal(slot?.version, 3);
  assert.equal(doc.version, 1);
  assert.equal(slot?.data.note, "kept");
  assert.equal(slot?.data.gdp, undefined);
  assert.equal(slot?.data.debt, undefined);
  assert.equal(slot?.data.floor, undefined);
  // A NaN inside an array is removed, not turned into a null hole.
  assert.deepEqual(slot?.data.list, [1, 2]);
  assert.equal(JSON.stringify(doc).includes("lost"), false);

  assert.doesNotThrow(() => {
    JSON.stringify(doc);
  });
});

test("an override for a province id the manifest does not carry is kept, not dropped", () => {
  // 1648 provinces span ids 1..1650; 1318 and 1458 do not exist. State is read
  // synchronously at startup while the map load is still in flight, so
  // `normalizeState` cannot consult the manifest and must not try.
  const result = normalizeState({
    version: 1,
    provinceOverrides: {
      "1318": { name: "Ghost" },
      "1458": { lore: "Also absent." },
      "1650": { name: "Last" },
    },
    countries: [{ id: 1, provinceIds: [0, -1, 1.5, 1318, 1650] }],
    economics: {},
    nextCountryId: 1,
  });

  assert.equal(result.state.provinceOverrides.get(1318)?.name, "Ghost");
  assert.equal(result.state.provinceOverrides.get(1458)?.lore, "Also absent.");
  assert.equal(result.state.provinceOverrides.get(1650)?.name, "Last");
  // 0 is NO_PROVINCE, -1 and 1.5 are not province ids at all.
  assert.deepEqual(result.state.countries[0]?.provinceIds, [1318, 1650]);
  assert.deepEqual(result.repairs, [], "an unusual but legal id is not a repair");
});
