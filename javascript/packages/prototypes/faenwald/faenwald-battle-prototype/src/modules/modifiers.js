import { RANK_MODIFIERS } from "../data/modifiers.js";
import { STAT_META } from "../data/unit.js";
import { MODIFIERS_LS_KEY } from "../data/local-storage-keys.js";

/**
 * Domain module for modifier collections, persisted through the storage
 * adapter injected by the composition root (model.js passes localStorage;
 * tests pass a fake).
 *
 * A percent entry's value is a fraction (0.3 == +30%), matching computeStats.
 * A modifier's effective, cross-collection id is `${collection.id}:${modifier.id}`;
 * units reference one via a composite { collectionId, modifierId }.
 */

const makeEntry = (modifiers, stat, value) => ({ id: modifiers.nextEntryId++, stat, value });

/**
 * One collection wrapping the static catalog, converted from the object shape
 * ({ hp: 30 }) to the array shape ([{ stat: "hp", value: 30 }]).
 */
const seedCollections = (modifiers) => {
  modifiers.collections = [
    {
      id: 1,
      name: "Ранги",
      modifiers: RANK_MODIFIERS.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        flat: Object.entries(m.flat).map(([stat, value]) => makeEntry(modifiers, stat, value)),
        percent: Object.entries(m.percent).map(([stat, value]) => makeEntry(modifiers, stat, value)),
      })),
    },
  ];
};

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

/**
 * The entry counter is derived from the data (not persisted) so it never
 * collides with ids already in the collections after a reload.
 */
const reseedEntryCounter = (modifiers) => {
  let max = 0;
  for (const c of modifiers.collections) {
    for (const m of c.modifiers) {
      for (const e of [...m.flat, ...m.percent]) {
        if (typeof e.id === "number" && e.id > max) {
          max = e.id;
        }
      }
    }
  }
  modifiers.nextEntryId = max + 1;
};

const nextCollectionId = (modifiers) =>
  modifiers.collections.reduce((max, c) => Math.max(max, Number(c.id) || 0), 0) + 1;

/**
 * Unique within the collection; frozen once assigned so composite refs stay valid.
 * Ignores non-numeric seed ids (slugs like "veteran"), so new ids are "1", "2", …
 */
const nextModifierId = (collection) =>
  String(collection.modifiers.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1);

// the adapter and counter are runtime wiring, not data — only collections are serialized
const persist = (modifiers) => {
  modifiers.storage.setItem(MODIFIERS_LS_KEY, JSON.stringify({ collections: modifiers.collections }));
};

/**
 * @param {{ storage: StorageAdapter }} deps
 * @returns {ModifiersState}
 */
const createModifiers = ({ storage }) => ({ storage, collections: [], nextEntryId: 1 });

/**
 * @param {ModifiersState} modifiers
 */
const hydrateModifiers = (modifiers) => {
  let data = null;
  try {
    data = JSON.parse(modifiers.storage.getItem(MODIFIERS_LS_KEY));
  } catch {
    data = null;
  }
  if (!isValidShape(data)) {
    seedCollections(modifiers);
    reseedEntryCounter(modifiers);
    persist(modifiers);
    return;
  }
  modifiers.collections = data.collections;
  reseedEntryCounter(modifiers);
};

/**
 * id may arrive as a string (route param) or number (in-memory) — compare loosely.
 *
 * @param {ModifiersState} modifiers
 * @param {number | string} id
 * @returns {ModifierCollection | null}
 */
const getCollection = (modifiers, id) =>
  modifiers.collections.find((c) => String(c.id) === String(id)) ?? null;

/**
 * Resolves a unit's composite ref; returns null when the collection or modifier
 * has since been deleted, so callers can defensively skip it.
 *
 * @param {ModifiersState} modifiers
 * @param {number | string} collectionId
 * @param {string} modifierId
 * @returns {Modifier | null}
 */
const findModifier = (modifiers, collectionId, modifierId) =>
  getCollection(modifiers, collectionId)?.modifiers.find(
    (m) => String(m.id) === String(modifierId),
  ) ?? null;

/**
 * Flattened view for the battle-creation picker: every modifier, tagged with its
 * owning collection so options can be labelled/searched/sorted by collection name.
 *
 * @param {ModifiersState} modifiers
 * @returns {{ collectionId: number, collectionName: string, modifier: Modifier }[]}
 */
const allModifiers = (modifiers) =>
  modifiers.collections.flatMap((c) =>
    c.modifiers.map((modifier) => ({
      collectionId: c.id,
      collectionName: c.name,
      modifier,
    })),
  );

/**
 * @param {ModifiersState} modifiers
 * @param {string} [name]
 * @returns {ModifierCollection}
 */
const createCollection = (modifiers, name = "New collection") => {
  const collection = { id: nextCollectionId(modifiers), name, modifiers: [] };
  modifiers.collections.push(collection);
  persist(modifiers);
  return collection;
};

/**
 * @param {ModifiersState} modifiers
 * @param {number | string} id
 * @param {string} name
 */
const renameCollection = (modifiers, id, name) => {
  const collection = getCollection(modifiers, id);
  if (!collection) {
    return;
  }
  collection.name = name;
  persist(modifiers);
};

/**
 * @param {ModifiersState} modifiers
 * @param {number | string} id
 */
const deleteCollection = (modifiers, id) => {
  modifiers.collections = modifiers.collections.filter((c) => String(c.id) !== String(id));
  persist(modifiers);
};

/**
 * @param {ModifiersState} modifiers
 * @param {number | string} collectionId
 * @returns {Modifier | null}
 */
const createModifier = (modifiers, collectionId) => {
  const collection = getCollection(modifiers, collectionId);
  if (!collection) {
    return null;
  }
  const modifier = {
    id: nextModifierId(collection),
    name: "new modifier",
    description: "",
    flat: [],
    percent: [],
  };
  collection.modifiers.push(modifier);
  persist(modifiers);
  return modifier;
};

/**
 * @param {ModifiersState} modifiers
 * @param {number | string} collectionId
 * @param {string} modifierId
 * @param {Partial<Modifier>} patch
 */
const updateModifier = (modifiers, collectionId, modifierId, patch) => {
  const modifier = findModifier(modifiers, collectionId, modifierId);
  if (!modifier) {
    return;
  }
  Object.assign(modifier, patch);
  persist(modifiers);
};

/**
 * @param {ModifiersState} modifiers
 * @param {number | string} collectionId
 * @param {string} modifierId
 */
const deleteModifier = (modifiers, collectionId, modifierId) => {
  const collection = getCollection(modifiers, collectionId);
  if (!collection) {
    return;
  }
  collection.modifiers = collection.modifiers.filter((m) => String(m.id) !== String(modifierId));
  persist(modifiers);
};

/**
 * @param {ModifiersState} modifiers
 * @param {number | string} collectionId
 * @param {string} modifierId
 * @param {"flat" | "percent"} kind
 */
const addEntry = (modifiers, collectionId, modifierId, kind) => {
  const modifier = findModifier(modifiers, collectionId, modifierId);
  if (!modifier) {
    return;
  }
  modifier[kind].push(makeEntry(modifiers, STAT_META[0].id, 0));
  persist(modifiers);
};

/**
 * @param {ModifiersState} modifiers
 * @param {number | string} collectionId
 * @param {string} modifierId
 * @param {"flat" | "percent"} kind
 * @param {number | string} entryId
 */
const removeEntry = (modifiers, collectionId, modifierId, kind, entryId) => {
  const modifier = findModifier(modifiers, collectionId, modifierId);
  if (!modifier) {
    return;
  }
  modifier[kind] = modifier[kind].filter((e) => String(e.id) !== String(entryId));
  persist(modifiers);
};

/**
 * @param {ModifiersState} modifiers
 * @param {number | string} collectionId
 * @param {string} modifierId
 * @param {"flat" | "percent"} kind
 * @param {number | string} entryId
 * @param {Partial<ModifierEntry>} patch
 */
const updateEntry = (modifiers, collectionId, modifierId, kind, entryId, patch) => {
  const modifier = findModifier(modifiers, collectionId, modifierId);
  if (!modifier) {
    return;
  }
  const entry = modifier[kind].find((e) => String(e.id) === String(entryId));
  if (!entry) {
    return;
  }
  Object.assign(entry, patch);
  persist(modifiers);
};

const MODIFIERS_MODULE = {
  create: createModifiers,
  hydrate: hydrateModifiers,
  getCollection: getCollection,
  findModifier: findModifier,
  allModifiers: allModifiers,
  createCollection: createCollection,
  renameCollection: renameCollection,
  deleteCollection: deleteCollection,
  createModifier: createModifier,
  updateModifier: updateModifier,
  deleteModifier: deleteModifier,
  addEntry: addEntry,
  removeEntry: removeEntry,
  updateEntry: updateEntry,
};

export { MODIFIERS_MODULE };
