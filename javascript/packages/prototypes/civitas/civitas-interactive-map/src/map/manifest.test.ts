import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { indexProvincesById, parseManifest, parseManifestText } from "./manifest";
import { buildColorIndex } from "./province-index";

const manifestPath = fileURLToPath(new URL("../../assets/provinces_manifest.json", import.meta.url));

// A fresh object every call, so a test that mutates its fixture cannot leak into
// the next one.
function validManifest(): Record<string, unknown> {
  return {
    format: "civitas.province-map",
    version: 1,
    map: { source: "Karta_provintsiy.png", width: 3653, height: 2855 },
    provinces: [
      {
        id: 1,
        name: "Province 1",
        kind: "land",
        hex: "#98d7ab",
        rgb: [152, 215, 171],
        pixelCount: 1152,
        bounds: { x: 577, y: 364, width: 37, height: 58 },
        centroid: { x: 598, y: 391 },
      },
      {
        id: 7,
        name: "Province 7",
        kind: "sea",
        hex: "#010203",
        rgb: [1, 2, 3],
        pixelCount: 4,
        bounds: { x: 0, y: 0, width: 2, height: 2 },
        centroid: { x: 1, y: 1 },
      },
    ],
    painted: { pixelCount: 2756578, coverage: 0.264311, unregisteredColors: [] },
  };
}

// `provinces[0]` after a cast, so a test can mutate one field without fighting
// the index signature on every line.
function firstProvince(fixture: Record<string, unknown>): Record<string, unknown> {
  return (fixture.provinces as Record<string, unknown>[])[0];
}

test("the fixture parses and every field survives intact", () => {
  const parsed = parseManifest(validManifest());

  assert.equal(parsed.format, "civitas.province-map");
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.map, { source: "Karta_provintsiy.png", width: 3653, height: 2855 });
  assert.equal(parsed.provinces.length, 2);

  const first = parsed.provinces[0];
  assert.equal(first.id, 1);
  assert.equal(first.name, "Province 1");
  assert.equal(first.kind, "land");
  assert.equal(first.hex, "#98d7ab");
  assert.deepEqual(first.rgb, [152, 215, 171]);
  assert.equal(first.rgb.length, 3);
  assert.equal(first.pixelCount, 1152);
  assert.deepEqual(first.bounds, { x: 577, y: 364, width: 37, height: 58 });
  assert.deepEqual(first.centroid, { x: 598, y: 391 });
  assert.equal(parsed.provinces[1].kind, "sea");
  assert.deepEqual(parsed.painted, {
    pixelCount: 2756578,
    coverage: 0.264311,
    unregisteredColors: [],
  });
});

test("the parser returns new objects, so unvalidated keys cannot leak through", () => {
  const fixture = validManifest();
  const extra = firstProvince(fixture);
  extra.somethingElse = "should not survive";

  const parsed = parseManifest(fixture);

  assert.notEqual(parsed.provinces[0] as unknown, extra);
  assert.notEqual(parsed.map as unknown, fixture.map);
  assert.equal((parsed.provinces[0] as unknown as Record<string, unknown>).somethingElse, undefined);
  // The rgb tuple is rebuilt too, so a later mutation of the source array cannot
  // repaint a province.
  assert.notEqual(parsed.provinces[0].rgb as unknown, extra.rgb);
});

test("a payload that is not a JSON object is rejected", () => {
  assert.throws(() => parseManifest(null), /manifest is not a JSON object/);
  assert.throws(() => parseManifest(42), /manifest is not a JSON object/);
  assert.throws(() => parseManifest("text"), /manifest is not a JSON object/);
  assert.throws(() => parseManifest([]), /manifest is not a JSON object/);
  assert.throws(() => parseManifest(undefined), /manifest is not a JSON object/);
});

test("a wrong or missing format is rejected and the message quotes what it found", () => {
  const missing = validManifest();
  delete missing.format;
  assert.throws(() => parseManifest(missing), /manifest format is undefined, expected/);

  const wrong = validManifest();
  wrong.format = "civitas.province-map-v2";
  assert.throws(
    () => parseManifest(wrong),
    /manifest format is "civitas.province-map-v2", expected "civitas.province-map"/,
  );
});

test("a wrong or missing version is rejected, and the string \"1\" is not the number 1", () => {
  const missing = validManifest();
  delete missing.version;
  assert.throws(() => parseManifest(missing), /manifest version is undefined, expected 1/);

  const future = validManifest();
  future.version = 2;
  assert.throws(() => parseManifest(future), /manifest version is 2, expected 1/);

  const stringy = validManifest();
  stringy.version = "1";
  assert.throws(() => parseManifest(stringy), /manifest version is "1", expected 1/);
});

test("a missing or malformed map block is rejected", () => {
  const missing = validManifest();
  delete missing.map;
  assert.throws(() => parseManifest(missing), /manifest map must have a source string/);

  for (const width of [0, -1, 3653.5, "3653"]) {
    const bad = validManifest();
    bad.map = { source: "x.png", width, height: 2855 };
    assert.throws(() => parseManifest(bad), /manifest map must have a source string/);
  }

  const noSource = validManifest();
  noSource.map = { width: 3653, height: 2855 };
  assert.throws(() => parseManifest(noSource), /manifest map must have a source string/);
});

test("a missing or non-array provinces list is rejected", () => {
  const missing = validManifest();
  delete missing.provinces;
  assert.throws(() => parseManifest(missing), /manifest has no provinces array/);

  const object = validManifest();
  object.provinces = { "1": {} };
  assert.throws(() => parseManifest(object), /manifest has no provinces array/);
});

test("a duplicate or non-positive province id is rejected", () => {
  const duplicate = validManifest();
  (duplicate.provinces as Record<string, unknown>[])[1].id = 1;
  assert.throws(
    () => parseManifest(duplicate),
    /manifest province at index 1: id 1 is already used/,
  );

  const zero = validManifest();
  firstProvince(zero).id = 0;
  assert.throws(
    () => parseManifest(zero),
    /manifest province at index 0: id must be a positive integer/,
  );
});

test("a bad name or kind is rejected", () => {
  const noName = validManifest();
  firstProvince(noName).name = 12;
  assert.throws(() => parseManifest(noName), /index 0: name must be a string/);

  const badKind = validManifest();
  firstProvince(badKind).kind = "mountain";
  assert.throws(() => parseManifest(badKind), /index 0: kind must be land, sea or lake/);
});

test("rgb must be exactly three integers in 0..255", () => {
  const cases: unknown[] = [
    [152, 215],
    [152, 215, 171, 255],
    [152, 215, 300],
    [152, 215, -1],
    [152, 215, 171.5],
    ["152", 215, 171],
    "98d7ab",
  ];
  for (const rgb of cases) {
    const bad = validManifest();
    firstProvince(bad).rgb = rgb;
    assert.throws(
      () => parseManifest(bad),
      /index 0: rgb must be three integers in 0\.\.255/,
      "rgb " + JSON.stringify(rgb) + " should be rejected",
    );
  }
});

test("hex must be #rrggbb and must agree with rgb", () => {
  const noHash = validManifest();
  firstProvince(noHash).hex = "98d7ab";
  assert.throws(() => parseManifest(noHash), /index 0: hex must be #rrggbb/);

  const tooShort = validManifest();
  firstProvince(tooShort).hex = "#98d";
  assert.throws(() => parseManifest(tooShort), /index 0: hex must be #rrggbb/);

  const disagreeing = validManifest();
  firstProvince(disagreeing).hex = "#98d7ac";
  assert.throws(
    () => parseManifest(disagreeing),
    /index 0: hex #98d7ac disagrees with rgb \[152, 215, 171\]/,
  );

  // Upper case is legal notation and must still be accepted.
  const upper = validManifest();
  firstProvince(upper).hex = "#98D7AB";
  assert.equal(parseManifest(upper).provinces[0].hex, "#98D7AB");
});

test("pixelCount, bounds and centroid must be non-negative integers", () => {
  const negativeCount = validManifest();
  firstProvince(negativeCount).pixelCount = -1;
  assert.throws(
    () => parseManifest(negativeCount),
    /index 0: pixelCount must be a non-negative integer/,
  );

  const partialBounds = validManifest();
  firstProvince(partialBounds).bounds = { x: 1, y: 2, width: 3 };
  assert.throws(
    () => parseManifest(partialBounds),
    /index 0: bounds must be four non-negative integers/,
  );

  const negativeBounds = validManifest();
  firstProvince(negativeBounds).bounds = { x: -1, y: 2, width: 3, height: 4 };
  assert.throws(
    () => parseManifest(negativeBounds),
    /index 0: bounds must be four non-negative integers/,
  );

  const fractionalCentroid = validManifest();
  firstProvince(fractionalCentroid).centroid = { x: 598.5, y: 391 };
  assert.throws(
    () => parseManifest(fractionalCentroid),
    /index 0: centroid must be two non-negative integers/,
  );

  const notAProvince = validManifest();
  (notAProvince.provinces as unknown[])[0] = 7;
  assert.throws(() => parseManifest(notAProvince), /index 0: province must be a JSON object/);
});

test("a missing or malformed painted summary is rejected", () => {
  const missing = validManifest();
  delete missing.painted;
  assert.throws(() => parseManifest(missing), /manifest painted summary is missing or malformed/);

  const badColors = validManifest();
  badColors.painted = { pixelCount: 1, coverage: 0.5, unregisteredColors: [42] };
  assert.throws(() => parseManifest(badColors), /manifest painted summary is missing or malformed/);

  const badCoverage = validManifest();
  badCoverage.painted = { pixelCount: 1, coverage: Number.NaN, unregisteredColors: [] };
  assert.throws(
    () => parseManifest(badCoverage),
    /manifest painted summary is missing or malformed/,
  );
});

test("parseManifestText reports broken JSON as such", () => {
  assert.throws(() => parseManifestText("{ not json"), /manifest is not valid JSON/);
  // A dev server answering a missing path with index.html lands here too.
  assert.throws(() => parseManifestText("<!doctype html>"), /manifest is not valid JSON/);
  // Valid JSON that is not a manifest falls through to the shape checks.
  assert.throws(() => parseManifestText("[]"), /manifest is not a JSON object/);
});

test("the real shipped manifest parses", () => {
  const parsed = parseManifestText(readFileSync(manifestPath, "utf8"));

  assert.equal(parsed.provinces.length, 1648);
  assert.equal(parsed.map.width, 3653);
  assert.equal(parsed.map.height, 2855);
  assert.equal(parsed.painted.pixelCount, 2756578);
  assert.deepEqual(parsed.painted.unregisteredColors, []);
  for (const province of parsed.provinces) {
    assert.equal(province.kind, "land");
  }
});

test("the parser copies the centre of mass through and never recomputes it", () => {
  // PLAN section 2: `centroid` is the centre of MASS, not the centre of the
  // bounding box. T07 places country labels on it. A parser that "helpfully"
  // derived it from `bounds` would move most labels and nothing else would
  // notice, so the parsed value is compared against the raw JSON field by field.
  const text = readFileSync(manifestPath, "utf8");
  const raw = JSON.parse(text) as {
    provinces: { centroid: { x: number; y: number } }[];
  };
  const parsed = parseManifestText(text);

  let offBoxCentre = 0;
  for (let i = 0; i < parsed.provinces.length; i += 1) {
    const province = parsed.provinces[i];
    assert.equal(province.centroid.x, raw.provinces[i].centroid.x);
    assert.equal(province.centroid.y, raw.provinces[i].centroid.y);

    const boxX = province.bounds.x + province.bounds.width / 2;
    const boxY = province.bounds.y + province.bounds.height / 2;
    if (Math.abs(province.centroid.x - boxX) > 1 || Math.abs(province.centroid.y - boxY) > 1) {
      offBoxCentre += 1;
    }
  }

  // 1314 of 1648 centroids sit more than a pixel away from their bounding-box
  // centre. A manifest regenerated with bbox centres would score 0 here.
  assert.equal(offBoxCentre, 1314);
  assert.ok(offBoxCentre > parsed.provinces.length / 2);

  // Province 1, spelled out: bbox centre (595.5, 393), centre of mass (598, 391).
  assert.deepEqual(parsed.provinces[0].bounds, { x: 577, y: 364, width: 37, height: 58 });
  assert.deepEqual(parsed.provinces[0].centroid, { x: 598, y: 391 });
});

test("the parser does not police colours — that is buildColorIndex's job", () => {
  // The split is deliberate (DESIGN section 2): a colour collision only matters
  // where the pixel lookup is built, so `manifest.ts` stays free of packing
  // knowledge. Moving the check into the parser would pass the first half of
  // this test and fail the second.
  const clashing = validManifest();
  const second = (clashing.provinces as Record<string, unknown>[])[1];
  second.rgb = [152, 215, 171];
  second.hex = "#98d7ab";

  const parsed = parseManifest(clashing);
  assert.equal(parsed.provinces.length, 2);
  assert.deepEqual(parsed.provinces[1].rgb, [152, 215, 171]);

  assert.throws(
    () => {
      return buildColorIndex(parsed.provinces);
    },
    /provinces 1 and 7 share colour #98d7ab/,
  );
});

test("indexProvincesById keys on the id, and the id is not the array position", () => {
  const parsed = parseManifestText(readFileSync(manifestPath, "utf8"));
  const byId = indexProvincesById(parsed.provinces);

  assert.equal(byId.size, 1648);
  assert.equal(byId.get(1)?.hex, "#98d7ab");
  assert.ok(byId.get(1650), "id 1650 exists even though there are only 1648 provinces");

  // The two ids that do not exist. This is the trap: `provinces[id - 1]` is
  // wrong for every id past 1318.
  assert.equal(byId.get(1318), undefined);
  assert.equal(byId.get(1458), undefined);
  assert.notEqual(parsed.provinces[1317].id, 1318);
});
