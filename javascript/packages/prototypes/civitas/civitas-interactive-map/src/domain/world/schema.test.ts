import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_DATA_URL_MAX,
  LORE_MAX,
  NAME_MAX,
  STATE_VERSION,
  countryDisplayName,
  createCountry,
  createEmptyState,
  defaultCountryColor,
  normalizeState,
  serializeState,
  type CivitasState,
} from "./schema";

// Document shape, sparsity rule and repairing parser.

const IMAGE = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=";

function populated(): CivitasState {
  const state = createEmptyState();
  state.provinceOverrides.set(7, { name: "Alnwick", lore: "A border keep.", imageDataUrl: IMAGE });
  state.provinceOverrides.set(1650, { lore: "The last id in the manifest." });

  const first = createCountry(1, "Testland");
  first.slogan = "Ever onward";
  first.lore = "Founded in a hurry.";
  first.flagDataUrl = IMAGE;
  first.provinceIds = [7, 12, 1650];
  const second = createCountry(2, "Otherland");
  second.colorHex = "#123456";
  second.provinceIds = [3];

  state.countries.push(first, second);
  state.nextCountryId = 3;
  return state;
}

test("createEmptyState hands out fresh containers on every call", () => {
  const first = createEmptyState();
  first.provinceOverrides.set(1, { name: "x" });
  first.countries.push(createCountry(1));

  const second = createEmptyState();
  assert.equal(second.provinceOverrides.size, 0);
  assert.equal(second.countries.length, 0);
  assert.equal(second.nextCountryId, 1);
});

test("countryDisplayName falls back for an empty or blank name and leaves a real one alone", () => {
  // One fallback string shared by the plaque, the label and the panel.
  assert.equal(countryDisplayName(1, "Testland"), "Testland");
  assert.equal(countryDisplayName(1, ""), "Country 1");
  assert.equal(countryDisplayName(3, "   "), "Country 3");
  assert.equal(countryDisplayName(3, "\n\t"), "Country 3");
  // No trim: trimming would fight the user while typing.
  assert.equal(countryDisplayName(3, " New"), " New");
  assert.equal(countryDisplayName(4, undefined as unknown as string), "Country 4");
  assert.equal(countryDisplayName(4, 7 as unknown as string), "Country 4");
});

test("createCountry routes its name through the same fallback", () => {
  assert.equal(createCountry(3).name, "Country 3");
  assert.equal(createCountry(3, "").name, "Country 3");
  assert.equal(createCountry(3, "   ").name, "Country 3");
  assert.equal(createCountry(3, "Testland").name, "Testland");
  assert.equal(createCountry(3, "x".repeat(NAME_MAX + 40)).name.length, NAME_MAX);
});

test("an empty state serialises to a tiny document carrying the schema version", () => {
  const doc = serializeState(createEmptyState());

  assert.equal(doc.version, STATE_VERSION);
  assert.deepEqual(doc.provinceOverrides, {});
  assert.deepEqual(doc.countries, []);
  assert.ok(JSON.stringify(doc).length < 200, "an empty document must stay under 200 bytes");
});

test("overrides stay sparse: 2 edits out of 1648 provinces write 2 keys", () => {
  // Sparsity: a record per province would fail here.
  const state = createEmptyState();
  state.provinceOverrides.set(7, { name: "Alnwick" });
  state.provinceOverrides.set(900, { lore: "Salt marsh." });

  const doc = serializeState(state);
  const keys = Object.keys(doc.provinceOverrides);

  assert.deepEqual(keys.sort(), ["7", "900"]);
  assert.equal(doc.provinceOverrides["8"], undefined);
  assert.ok(
    JSON.stringify(doc).length < 1024,
    "two overrides must not produce a kilobyte of document",
  );
});

test("serializeState omits empty fields, and omits a province left with none", () => {
  const state = createEmptyState();
  state.provinceOverrides.set(7, { name: "Alnwick", lore: "" });
  state.provinceOverrides.set(8, { name: "", lore: "", imageDataUrl: "" });

  const doc = serializeState(state);

  assert.deepEqual(doc.provinceOverrides["7"], { name: "Alnwick" });
  assert.equal(doc.provinceOverrides["8"], undefined);
});

test("serializeState returns copies, never references into the state", () => {
  const state = populated();
  const doc = serializeState(state);

  doc.countries[0]?.provinceIds.push(999);
  doc.provinceOverrides["7"] = { name: "clobbered" };

  assert.deepEqual(state.countries[0]?.provinceIds, [7, 12, 1650]);
  assert.equal(state.provinceOverrides.get(7)?.name, "Alnwick");
});

test("serializeState sorts provinceIds, so equal states stringify identically", () => {
  const left = createEmptyState();
  const leftCountry = createCountry(1);
  leftCountry.provinceIds = [12, 7, 1650];
  left.countries.push(leftCountry);
  left.nextCountryId = 2;

  const right = createEmptyState();
  const rightCountry = createCountry(1);
  rightCountry.provinceIds = [1650, 7, 12];
  right.countries.push(rightCountry);
  right.nextCountryId = 2;

  assert.equal(JSON.stringify(serializeState(left)), JSON.stringify(serializeState(right)));
});

test("normalizeState(serializeState(state)) is the original state", () => {
  const state = populated();
  const result = normalizeState(serializeState(state));

  assert.deepEqual(result.repairs, []);
  assert.deepEqual(result.state, state);
});

test("province keys that are not decimal ids are dropped and counted", () => {
  // JSON.parse makes `__proto__` an own key, as in a hand-edited document.
  // An object literal would set the prototype instead.
  const raw = JSON.parse(
    "{\"version\":1,\"provinceOverrides\":{" +
      "\"7\":{\"name\":\"kept\"}," +
      "\"0\":{\"name\":\"zero is NO_PROVINCE\"}," +
      "\"-3\":{\"name\":\"negative\"}," +
      "\"1.5\":{\"name\":\"fractional\"}," +
      "\"__proto__\":{\"name\":\"pollution\"}," +
      "\"abc\":{\"name\":\"not a number\"}," +
      "\"9\":\"not an object\"}}",
  ) as unknown;
  const result = normalizeState(raw);

  assert.deepEqual([...result.state.provinceOverrides.keys()], [7]);
  assert.match(result.repairs.join(" "), /dropped 6 malformed province overrides/);
  // The prototype stays untouched.
  assert.equal(({} as { name?: string }).name, undefined);
});

test("an over-length name and lore are truncated to their caps", () => {
  const result = normalizeState({
    version: 1,
    provinceOverrides: { "7": { name: "n".repeat(400), lore: "l".repeat(20000) } },
  });

  const override = result.state.provinceOverrides.get(7);
  assert.equal(override?.name?.length, NAME_MAX);
  assert.equal(override?.lore?.length, LORE_MAX);
});

test("an image that is not a data URL, or is oversized, is dropped", () => {
  const result = normalizeState({
    version: 1,
    provinceOverrides: {
      "7": { name: "kept", imageDataUrl: "http://example.test/flag.png" },
      "8": { name: "kept", imageDataUrl: "data:image/png;base64," + "A".repeat(IMAGE_DATA_URL_MAX) },
      "9": { imageDataUrl: IMAGE },
    },
  });

  assert.equal(result.state.provinceOverrides.get(7)?.imageDataUrl, undefined);
  assert.equal(result.state.provinceOverrides.get(8)?.imageDataUrl, undefined);
  assert.equal(result.state.provinceOverrides.get(9)?.imageDataUrl, IMAGE);
  assert.match(result.repairs.join(" "), /dropped 2 invalid province images/);
});

test("a bad colorHex falls back to the default palette entry, a good one survives", () => {
  const result = normalizeState({
    version: 1,
    countries: [
      { id: 1, colorHex: "#ab" },
      { id: 2, colorHex: "#123456" },
    ],
  });

  assert.equal(result.state.countries[0]?.colorHex, defaultCountryColor(1));
  assert.equal(result.state.countries[1]?.colorHex, "#123456");
  assert.match(result.repairs.join(" "), /reset 1 country colours/);
});

test("a province claimed twice stays with the first country, and ids are sorted", () => {
  const result = normalizeState({
    version: 1,
    countries: [
      { id: 1, provinceIds: [12, 7, 7, 3] },
      { id: 2, provinceIds: [7, 12, 40] },
    ],
  });

  assert.deepEqual(result.state.countries[0]?.provinceIds, [3, 7, 12]);
  assert.deepEqual(result.state.countries[1]?.provinceIds, [40]);
  assert.match(result.repairs.join(" "), /dropped 3 duplicate province claims/);
});

test("duplicate, zero, oversized and non-integer country ids are dropped", () => {
  const result = normalizeState({
    version: 1,
    countries: [
      { id: 1, name: "first" },
      { id: 1, name: "duplicate" },
      { id: 0, name: "reserved" },
      { id: 65536, name: "past the Uint16Array ceiling" },
      { id: 2.5, name: "fractional" },
      { id: 2, name: "second" },
    ],
  });

  assert.deepEqual(
    result.state.countries.map((country) => {
      return country.name;
    }),
    ["first", "second"],
  );
  assert.match(result.repairs.join(" "), /dropped 4 malformed countries/);
});

test("nextCountryId is forced above the highest surviving country id", () => {
  const result = normalizeState({
    version: 1,
    countries: [{ id: 9 }, { id: 40 }],
    nextCountryId: 2,
  });

  assert.equal(result.state.nextCountryId, 41);
});

// Old documents may carry an `economics` key. It is ignored without a repair
// note, and the next write drops it.
test("a legacy economics key loads without a repair and is not written back", () => {
  const result = normalizeState({
    version: 1,
    countries: [{ id: 1, name: "Testland" }],
    economics: {
      "1": { version: 2, data: { gdp: 12 } },
      "99": { version: 1, data: { orphan: true } },
    },
    nextCountryId: 2,
  });

  assert.deepEqual(result.repairs, []);
  assert.equal(result.state.countries[0]?.name, "Testland");
  assert.equal("economics" in serializeState(result.state), false);
});

test("normalizeState never throws", () => {
  for (const hostile of [null, [], "x", 7, true, undefined]) {
    const result = normalizeState(hostile);
    assert.equal(result.state.countries.length, 0);
    assert.equal(result.repairs.length, 1);
  }
});
