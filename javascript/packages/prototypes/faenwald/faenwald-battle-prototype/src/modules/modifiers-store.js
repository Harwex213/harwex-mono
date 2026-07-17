import { MODIFIERS, STAT_META } from "../data/catalog.js";

// Domain store for modifier collections. Mirrors battle-config.js: a module
// singleton mutated only through the exported helpers, but this one is also
// hydrated from / persisted to localStorage so edits survive a reload.
//
// Shapes:
//   collection = { id: number, name: string, modifiers: Modifier[] }
//   modifier   = { id: string, name, description, flat: Entry[], percent: Entry[] }
//   entry      = { id: number, stat: string, value: number }
// A percent entry's value is a fraction (0.3 == +30%), matching computeStats.
// A modifier's effective, cross-collection id is `${collection.id}:${modifier.id}`;
// units reference one via a composite { collectionId, modifierId }.

const STORAGE_KEY = "hw.faenwald.modifiers.v1";

const store = { collections: [] };

// entry ids are unique across the whole store so a focus key survives re-render
let nextEntryId = 1;
const makeEntry = (stat, value) => ({ id: nextEntryId++, stat, value });

// one "Default" collection wrapping the static catalog, converted from the
// object shape ({ hp: 30 }) to the array shape ([{ stat: "hp", value: 30 }])
const seed = () => ({
  collections: [
    {
      id: 1,
      name: "Default",
      modifiers: MODIFIERS.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        flat: Object.entries(m.flat).map(([stat, value]) => makeEntry(stat, value)),
        percent: Object.entries(m.percent).map(([stat, value]) => makeEntry(stat, value)),
      })),
    },
  ],
});

const isValidShape = (data) =>
  Boolean(data) &&
  Array.isArray(data.collections) &&
  data.collections.every(
    (c) =>
      c &&
      c.id != null &&
      typeof c.name === "string" &&
      Array.isArray(c.modifiers) &&
      c.modifiers.every((m) => m && Array.isArray(m.flat) && Array.isArray(m.percent)),
  );

// counters are derived from the data (not persisted) so they never collide
// with ids already in the store after a reload
const reseedEntryCounter = () => {
  let max = 0;
  for (const c of store.collections) {
    for (const m of c.modifiers) {
      for (const e of [...m.flat, ...m.percent]) {
        if (typeof e.id === "number" && e.id > max) max = e.id;
      }
    }
  }
  nextEntryId = max + 1;
};

const nextCollectionId = () =>
  store.collections.reduce((max, c) => Math.max(max, Number(c.id) || 0), 0) + 1;

// unique within the collection; frozen once assigned so composite refs stay valid.
// ignores non-numeric seed ids (slugs like "veteran"), so new ids are "1", "2", …
const nextModifierId = (collection) =>
  String(collection.modifiers.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1);

const persist = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

const load = () => {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    data = null;
  }
  if (!isValidShape(data)) {
    store.collections = seed().collections;
    reseedEntryCounter();
    persist();
    return;
  }
  store.collections = data.collections;
  reseedEntryCounter();
};

load();

const getCollections = () => store.collections;

// id may arrive as a string (route param) or number (in-memory) — compare loosely
const getCollection = (id) =>
  store.collections.find((c) => String(c.id) === String(id)) ?? null;

const getModifier = (collectionId, modifierId) =>
  getCollection(collectionId)?.modifiers.find((m) => String(m.id) === String(modifierId)) ?? null;

// resolves a unit's composite ref; returns null when the collection or modifier
// has since been deleted, so callers can defensively skip it
const findModifier = (collectionId, modifierId) => getModifier(collectionId, modifierId);

// flattened view for the battle-creation picker: every modifier, tagged with its
// owning collection so options can be labelled/searched/sorted by collection name
const allModifiers = () =>
  store.collections.flatMap((c) =>
    c.modifiers.map((modifier) => ({
      collectionId: c.id,
      collectionName: c.name,
      modifier,
    })),
  );

const createCollection = (name = "New collection") => {
  const collection = { id: nextCollectionId(), name, modifiers: [] };
  store.collections.push(collection);
  persist();
  return collection;
};

const renameCollection = (id, name) => {
  const collection = getCollection(id);
  if (!collection) return;
  collection.name = name;
  persist();
};

const deleteCollection = (id) => {
  store.collections = store.collections.filter((c) => String(c.id) !== String(id));
  persist();
};

const createModifier = (collectionId) => {
  const collection = getCollection(collectionId);
  if (!collection) return null;
  const modifier = {
    id: nextModifierId(collection),
    name: "new modifier",
    description: "",
    flat: [],
    percent: [],
  };
  collection.modifiers.push(modifier);
  persist();
  return modifier;
};

const updateModifier = (collectionId, modifierId, patch) => {
  const modifier = getModifier(collectionId, modifierId);
  if (!modifier) return;
  Object.assign(modifier, patch);
  persist();
};

const deleteModifier = (collectionId, modifierId) => {
  const collection = getCollection(collectionId);
  if (!collection) return;
  collection.modifiers = collection.modifiers.filter((m) => String(m.id) !== String(modifierId));
  persist();
};

const addEntry = (collectionId, modifierId, kind) => {
  const modifier = getModifier(collectionId, modifierId);
  if (!modifier) return;
  modifier[kind].push(makeEntry(STAT_META[0].id, 0));
  persist();
};

const removeEntry = (collectionId, modifierId, kind, entryId) => {
  const modifier = getModifier(collectionId, modifierId);
  if (!modifier) return;
  modifier[kind] = modifier[kind].filter((e) => String(e.id) !== String(entryId));
  persist();
};

const updateEntry = (collectionId, modifierId, kind, entryId, patch) => {
  const modifier = getModifier(collectionId, modifierId);
  if (!modifier) return;
  const entry = modifier[kind].find((e) => String(e.id) === String(entryId));
  if (!entry) return;
  Object.assign(entry, patch);
  persist();
};

export {
  getCollections,
  getCollection,
  findModifier,
  allModifiers,
  createCollection,
  renameCollection,
  deleteCollection,
  createModifier,
  updateModifier,
  deleteModifier,
  addEntry,
  removeEntry,
  updateEntry,
}
