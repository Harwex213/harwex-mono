import assert from "node:assert/strict";
import test from "node:test";
import { STATE_KEY, createMemoryStorage } from "../datasource/index";
import {
  IMAGE_DATA_URL_MAX,
  countryDisplayName,
  createCountry,
  createEmptyState,
  serializeState,
} from "../domain/world/schema";
import { buildCountryOf } from "../domain/index";
import { provinceDisplayName } from "../store/index";
import { createTestApp, fakeTimers } from "../test-support";
import type { Migration, ProvinceOverride } from "../domain/index";
import type { StateDoc } from "../domain/world/schema";
import type { StateStorage } from "../datasource/index";
import type { FakeTimers, TestApp } from "../test-support";
import type { TStore } from "../store/index";

type BootOptions = { storage?: StateStorage; timers?: FakeTimers; chain?: readonly Migration[] };

// Each test builds its own app, so no state leaks between tests.
function boot(options: BootOptions): TestApp {
  const app = createTestApp({ storage: options.storage, timers: options.timers });
  app.registry.hydrateWorld({ chain: options.chain });
  return app;
}

function provinceOverrideOf(store: TStore, id: number): ProvinceOverride | null {
  return store.world.provinceOverrides.value.get(id) ?? null;
}

const IMAGE = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=";

function fakeStorage(onSet?: (key: string, value: string) => void): StateStorage {
  const inner = createMemoryStorage();
  return {
    getItem(key: string): string | null {
      return inner.getItem(key);
    },
    setItem(key: string, value: string): void {
      if (onSet) {
        onSet(key, value);
      }
      inner.setItem(key, value);
    },
    removeItem(key: string): void {
      inner.removeItem(key);
    },
  };
}

function storedDoc(storage: StateStorage): StateDoc | null {
  const raw = storage.getItem(STATE_KEY);
  if (raw === null) {
    return null;
  }
  return JSON.parse(raw) as StateDoc;
}

function quotaError(): unknown {
  const error = new Error("full") as Error & { name: string };
  error.name = "QuotaExceededError";
  return error;
}

test("init hydrates every signal from a stored document", () => {
  const storage = fakeStorage();
  const seed = createEmptyState();
  seed.provinceOverrides.set(7, { name: "Alnwick", imageDataUrl: IMAGE });
  const country = createCountry(1, "Testland");
  country.provinceIds = [7, 12];
  seed.countries.push(country);
  seed.nextCountryId = 2;
  storage.setItem(STATE_KEY, JSON.stringify(serializeState(seed)));

  const { store } = boot({ storage, timers: fakeTimers() });

  assert.equal(store.world.provinceOverrides.value.get(7)?.name, "Alnwick");
  assert.equal(store.world.countries.value.length, 1);
  assert.equal(store.world.countryById.value.get(1)?.name, "Testland");
  assert.equal(store.world.countryOfProvince.value.get(12), 1);
  assert.equal(store.world.nextCountryId.value, 2);
  assert.equal(store.world.warning.value, null);
  assert.equal(store.world.persistent.value, true);
});

test("init against an empty storage leaves empty signals and no warning", () => {
  const { store } = boot({ storage: fakeStorage(), timers: fakeTimers() });

  assert.equal(store.world.provinceOverrides.value.size, 0);
  assert.equal(store.world.countries.value.length, 0);
  assert.equal(store.world.warning.value, null);
  assert.equal(store.world.bytes.value, 0);
});

test("one edited province writes one key, not 1648", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  const { store, registry } = boot({ storage, timers });

  registry.setProvinceName(7, "Alnwick");
  timers.run();

  assert.equal(store.world.provinceOverrides.value.size, 1);
  assert.equal(provinceOverrideOf(store, 8), null);
  const doc = storedDoc(storage);
  assert.deepEqual(Object.keys(doc?.provinceOverrides ?? {}), ["7"]);
});

test("clearing a field removes it, and an emptied override leaves the map", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  const { store, registry } = boot({ storage, timers });

  registry.setProvinceName(7, "Alnwick");
  registry.setProvinceLore(7, "A border keep.");
  registry.setProvinceName(7, "");
  assert.deepEqual(provinceOverrideOf(store, 7), { lore: "A border keep." });

  registry.setProvinceLore(7, "");
  assert.equal(provinceOverrideOf(store, 7), null);
  assert.equal(store.world.provinceOverrides.value.size, 0);

  registry.setProvinceImage(7, IMAGE);
  assert.deepEqual(provinceOverrideOf(store, 7), { imageDataUrl: IMAGE });
  registry.clearProvinceOverride(7);
  assert.equal(store.world.provinceOverrides.value.size, 0);

  timers.run();
  assert.deepEqual(storedDoc(storage)?.provinceOverrides, {});
});

test("an unchanged value writes no signal and arms no timer", () => {
  const timers = fakeTimers();
  const { store, registry } = boot({ storage: fakeStorage(), timers });

  registry.setProvinceName(7, "Alnwick");
  timers.run();
  assert.equal(timers.armed(), 0);

  const before = store.world.provinceOverrides.value;
  registry.setProvinceName(7, "Alnwick");
  assert.equal(store.world.provinceOverrides.value, before, "the container must not be replaced");
  assert.equal(timers.armed(), 0, "a no-op keystroke must not arm the debounce");

  // A rejected image is a no-op: the caller has already validated it.
  registry.setProvinceImage(7, "http://example.test/flag.png");
  assert.equal(store.world.provinceOverrides.value, before);
  assert.equal(timers.armed(), 0);

  // Id 0 is NO_PROVINCE, and NaN is not an id.
  registry.setProvinceName(0, "reserved");
  registry.setProvinceName(Number.NaN, "not a number");
  assert.equal(store.world.provinceOverrides.value, before);
});

test("three mutations arm one timer and produce one document holding all three", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  const { registry } = boot({ storage, timers });

  registry.setProvinceName(7, "Alnwick");
  registry.setProvinceLore(7, "A border keep.");
  const country = registry.addCountry("Testland");

  assert.equal(timers.armed(), 1, "a fixed window arms exactly one timer");
  assert.equal(storedDoc(storage), null, "nothing is written before the window closes");

  timers.run();

  const doc = storedDoc(storage);
  assert.deepEqual(doc?.provinceOverrides["7"], { name: "Alnwick", lore: "A border keep." });
  assert.equal(doc?.countries[0]?.name, "Testland");
  assert.equal(country.id, 1);
});

test("flushState writes immediately without waiting for the timer", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  const { registry } = boot({ storage, timers });

  registry.setProvinceName(7, "Alnwick");
  registry.flushWorld();

  assert.equal(timers.armed(), 0);
  assert.deepEqual(Object.keys(storedDoc(storage)?.provinceOverrides ?? {}), ["7"]);
});

test("a quota failure keeps the in-memory state and clears once a write succeeds", () => {
  let full = true;
  const storage = fakeStorage((key) => {
    if (full && key === STATE_KEY) {
      throw quotaError();
    }
  });
  const timers = fakeTimers();
  const { store, registry } = boot({ storage, timers });

  registry.setProvinceName(7, "Alnwick");
  assert.doesNotThrow(() => {
    timers.run();
  });

  assert.equal(store.world.warning.value?.kind, "quota");
  assert.equal(provinceOverrideOf(store, 7)?.name, "Alnwick", "the edit survives a failed save");
  assert.equal(store.world.persistent.value, true, "a later delete may free space, so keep retrying");
  assert.equal(storedDoc(storage), null);

  full = false;
  registry.setProvinceLore(7, "A border keep.");
  timers.run();

  assert.equal(store.world.warning.value, null);
  assert.ok(store.world.bytes.value > 0);
  assert.equal(storedDoc(storage)?.provinceOverrides["7"]?.lore, "A border keep.");
});

test("a flag that will not fit stays on screen, and removing it saves and clears the warning", () => {
  // The flag path flushes at once, so the quota result is known at upload time.
  let full = true;
  const storage = fakeStorage((key) => {
    if (full && key === STATE_KEY) {
      throw quotaError();
    }
  });
  const timers = fakeTimers();
  const { store, registry } = boot({ storage, timers });

  const country = registry.addCountry("Testland");
  registry.updateCountry(country.id, { flagDataUrl: IMAGE });
  assert.doesNotThrow(() => {
    registry.flushWorld();
  });

  assert.equal(store.world.warning.value?.kind, "quota");
  assert.equal(
    store.world.countryById.value.get(country.id)?.flagDataUrl,
    IMAGE,
    "the upload survives a failed save, so the panel can still offer to remove it",
  );
  assert.equal(store.world.persistent.value, true);
  assert.equal(storedDoc(storage), null);

  // Removing the flag is the recovery, so it flushes and clears the warning at once.
  full = false;
  registry.updateCountry(country.id, { flagDataUrl: null });
  registry.flushWorld();

  assert.equal(store.world.warning.value, null);
  assert.equal(store.world.countryById.value.get(country.id)?.flagDataUrl, null);
  assert.equal(storedDoc(storage)?.countries[0]?.flagDataUrl, null);
});

test("country ids keep counting up across a reload", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  let { store, registry } = boot({ storage, timers });

  assert.equal(registry.addCountry().id, 1);
  assert.equal(registry.addCountry().id, 2);
  assert.equal(registry.addCountry("Third").id, 3);
  timers.run();

  ({ store, registry } = boot({ storage, timers: fakeTimers() }));
  assert.equal(store.world.countries.value.length, 3);
  assert.equal(registry.addCountry().id, 4, "a reused id would merge two countries' provinces");
});

test("assigning a province takes it from its previous owner in the same call", () => {
  const { store, registry } = boot({ storage: fakeStorage(), timers: fakeTimers() });
  const first = registry.addCountry("First");
  const second = registry.addCountry("Second");

  registry.assignProvinces(first.id, [7, 12, 3]);
  assert.deepEqual(store.world.countryById.value.get(first.id)?.provinceIds, [3, 7, 12]);

  registry.assignProvinces(second.id, [12]);
  assert.deepEqual(store.world.countryById.value.get(first.id)?.provinceIds, [3, 7]);
  assert.deepEqual(store.world.countryById.value.get(second.id)?.provinceIds, [12]);
  assert.equal(store.world.countryOfProvince.value.get(12), second.id);
});

test("assigning to null unassigns, and countryOfProvince loses the key", () => {
  const { store, registry } = boot({ storage: fakeStorage(), timers: fakeTimers() });
  const country = registry.addCountry("First");
  registry.assignProvinces(country.id, [7, 12]);

  registry.assignProvinces(null, [7]);

  assert.deepEqual(store.world.countryById.value.get(country.id)?.provinceIds, [12]);
  assert.equal(store.world.countryOfProvince.value.has(7), false);
});

test("deleting a country drops its claims but keeps province lore", () => {
  const { store, registry } = boot({ storage: fakeStorage(), timers: fakeTimers() });
  const country = registry.addCountry("Doomed");
  registry.assignProvinces(country.id, [7]);
  registry.setProvinceLore(7, "A border keep.");

  registry.deleteCountry(country.id);

  assert.equal(store.world.countries.value.length, 0);
  assert.equal(store.world.countryOfProvince.value.size, 0);
  assert.equal(provinceOverrideOf(store, 7)?.lore, "A border keep.");
});

test("buildCountryAssignment matches the Uint16Array the border worker takes", () => {
  const { store, registry } = boot({ storage: fakeStorage(), timers: fakeTimers() });
  const first = registry.addCountry("First");
  const second = registry.addCountry("Second");
  registry.assignProvinces(first.id, [7, 1650]);
  registry.assignProvinces(second.id, [12]);

  const assignment = buildCountryOf(store.world.countryOfProvince.value, 1650);

  assert.ok(assignment instanceof Uint16Array);
  assert.equal(assignment.length, 1651);
  assert.equal(assignment[0], 0, "index 0 is NO_PROVINCE, never a country");
  assert.equal(assignment[7], first.id);
  assert.equal(assignment[1650], first.id);
  assert.equal(assignment[12], second.id);
  // Ids 1318 and 1458 do not exist in the manifest and stay at 0.
  assert.equal(assignment[1318], 0);
  assert.equal(assignment[1458], 0);
});

test("a future-version document puts the store in read-only mode", () => {
  const storage = fakeStorage();
  const payload = "{\"version\":99,\"countries\":[{\"id\":1,\"name\":\"future\"}]}";
  storage.setItem(STATE_KEY, payload);
  const timers = fakeTimers();

  const { store, registry } = boot({ storage, timers });

  assert.equal(store.world.warning.value?.kind, "future");
  assert.equal(store.world.persistent.value, false);

  registry.setProvinceName(7, "Alnwick");
  registry.addCountry("Testland");
  registry.flushWorld();
  timers.run();

  assert.equal(provinceOverrideOf(store, 7)?.name, "Alnwick", "the session still works in memory");
  assert.equal(storage.getItem(STATE_KEY), payload, "the newer document must be byte-identical");
});

test("updateCountry validates its patch and provinceDisplayName layers the name", () => {
  const { store, registry } = boot({ storage: fakeStorage(), timers: fakeTimers() });
  const country = registry.addCountry("Testland");

  registry.updateCountry(country.id, { slogan: "Ever onward", colorHex: "#123456", flagDataUrl: IMAGE });
  assert.equal(store.world.countryById.value.get(country.id)?.slogan, "Ever onward");
  assert.equal(store.world.countryById.value.get(country.id)?.colorHex, "#123456");
  assert.equal(store.world.countryById.value.get(country.id)?.flagDataUrl, IMAGE);

  // A half-typed colour is ignored, not written as a broken value.
  registry.updateCountry(country.id, { colorHex: "#ab" });
  assert.equal(store.world.countryById.value.get(country.id)?.colorHex, "#123456");
  // A remote flag URL never enters the document.
  registry.updateCountry(country.id, { flagDataUrl: "http://example.test/flag.png" });
  assert.equal(store.world.countryById.value.get(country.id)?.flagDataUrl, IMAGE);
  // An unknown id is ignored.
  registry.updateCountry(99, { name: "ghost" });
  assert.equal(store.world.countries.value.length, 1);

  // No map in Node, so the last fallback answers.
  assert.equal(provinceDisplayName(store, 7), "Province 7");
  registry.setProvinceName(7, "Alnwick");
  assert.equal(provinceDisplayName(store, 7), "Alnwick");
});

test("updateCountry leaves provinceIds at the SAME array, not a copy", () => {
  // The label anchor cache keys on this array's identity. A copy would re-run
  // the anchor search on every keystroke.
  const { store, registry } = boot({ storage: fakeStorage(), timers: fakeTimers() });
  const country = registry.addCountry("Testland");
  registry.assignProvinces(country.id, [3, 4, 5]);

  const before = store.world.countryById.value.get(country.id)?.provinceIds;
  registry.updateCountry(country.id, { name: "Renamed" });
  const after = store.world.countryById.value.get(country.id)?.provinceIds;

  assert.equal(after, before, "a rename must not invalidate the label anchor cache");
});

test("every editable field keeps provinceIds at the same array", () => {
  // The panel commits each field per keystroke, so every branch must keep the identity.
  const { store, registry } = boot({ storage: fakeStorage(), timers: fakeTimers() });
  const country = registry.addCountry("Testland");
  registry.assignProvinces(country.id, [3, 4, 5]);
  const before = store.world.countryById.value.get(country.id)?.provinceIds;

  registry.updateCountry(country.id, { slogan: "Ever onward" });
  registry.updateCountry(country.id, { lore: "Founded in the long winter." });
  registry.updateCountry(country.id, { flagDataUrl: IMAGE });
  registry.updateCountry(country.id, { colorHex: "#123456" });

  const after = store.world.countryById.value.get(country.id)?.provinceIds;
  assert.equal(after, before);
  assert.deepEqual(after, [3, 4, 5], "and the contents are untouched");
});

test("a patch that changes nothing does not replace the countries array", () => {
  // An unchanged commit must not invalidate every country computed and the label layout.
  const { store, registry } = boot({ storage: fakeStorage(), timers: fakeTimers() });
  const country = registry.addCountry("Testland");
  const before = store.world.countries.value;

  registry.updateCountry(country.id, { name: "Testland" });
  assert.equal(store.world.countries.value, before, "the same name is a no-op");

  registry.updateCountry(country.id, { colorHex: "#nothex" });
  assert.equal(store.world.countries.value, before, "and so is a patch that fails validation");

  registry.updateCountry(country.id, { name: "Changed" });
  assert.notEqual(store.world.countries.value, before, "a real change still lands");
});

test("an over-cap flag is dropped without a word, and the store read-back is what catches it", () => {
  // `updateCountry` rejects a bad data URL silently. The panel detects it by
  // comparing the committed value with the stored one.
  const timers = fakeTimers();
  const { store, registry } = boot({ storage: fakeStorage(), timers });
  const country = registry.addCountry("Testland");
  registry.updateCountry(country.id, { flagDataUrl: IMAGE });
  timers.run();

  const head = "data:image/webp;base64,";
  const overCap = head + "A".repeat(IMAGE_DATA_URL_MAX - head.length + 1);
  assert.equal(overCap.length, IMAGE_DATA_URL_MAX + 1);

  registry.updateCountry(country.id, { flagDataUrl: overCap });

  // The same expression `CountryOverviewPanel.onFlag` runs after a commit.
  const stored = store.world.countryById.peek().get(country.id)?.flagDataUrl ?? null;
  assert.equal(stored, IMAGE, "the previous flag is untouched");
  assert.equal(stored !== overCap, true, "so the panel knows the upload never landed");
  assert.equal(timers.armed(), 0, "and a refused patch schedules no write");

  // A legal URL reads back equal, so the check gives no false alarm.
  const other = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAB=";
  registry.updateCountry(country.id, { flagDataUrl: other });
  assert.equal(store.world.countryById.peek().get(country.id)?.flagDataUrl, other);
});

test("an emptied country name is kept as empty on disk and reads back as the fallback", () => {
  // The store keeps "" to avoid editing user data, and surfaces show
  // `countryDisplayName`. A reload must agree with what the UI showed.
  const storage = fakeStorage();
  const timers = fakeTimers();
  let { store, registry } = boot({ storage, timers });
  const country = registry.addCountry("Testland");

  registry.updateCountry(country.id, { name: "" });
  timers.run();

  assert.equal(store.world.countryById.value.get(country.id)?.name, "");
  assert.equal(storedDoc(storage)?.countries[0]?.name, "");

  ({ store, registry } = boot({ storage, timers }));
  assert.equal(store.world.countryById.value.get(country.id)?.name, "Country 1");
  assert.equal(store.world.countryById.value.get(country.id)?.name, countryDisplayName(country.id, ""));

  // Whitespace is stored verbatim for the same reason and still shows the fallback.
  registry.updateCountry(country.id, { name: "   " });
  timers.run();
  ({ store, registry } = boot({ storage, timers }));

  assert.equal(store.world.countryById.value.get(country.id)?.name, "   ", "no silent edit on reload");
  assert.equal(countryDisplayName(country.id, "   "), "Country 1");
});
