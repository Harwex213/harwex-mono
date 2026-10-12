import type { SceneFile } from "./sceneFormat";

// The text of the scene file and the 3-way merge of two edits of it. The browser and the node tools
// (the dev server and `yarn scene`, scripts/) share this module, so the module has no runtime imports
// and uses only syntax that node can strip.
//
// A scene is a set of units: every object record (by id), every material entry (by name) and the settings.
// A unit is a set of fields: the keys of the record, with every component as a field of its own
// (`components.meshRenderer`), the keys of a material entry, the keys of the settings.
//
// An edit is a list of changed units, each with its value before the edit (`base`) and after it (`ours`).
// The merge puts an edit onto the current file (`theirs`) field by field:
// - a field that the edit did not change takes theirs;
// - a field that theirs did not change takes ours;
// - a field that both changed to the same value takes it;
// - a field that both changed to different values is a conflict.
// A unit that one side deleted and the other side changed is a conflict too.

type UnitKind = "object" | "material" | "settings";

// One changed unit of an edit. `null` is a unit that does not exist (added: base null, deleted: ours null).
interface Change {
  kind: UnitKind;
  key: string;
  base: unknown;
  ours: unknown;
}

// A unit that both sides changed. `fields` lists the fields in conflict; `["*"]` is a unit that one side
// deleted and the other side changed. The values are whole units, `null` when absent.
interface Conflict {
  kind: UnitKind;
  key: string;
  fields: string[];
  base: unknown;
  ours: unknown;
  theirs: unknown;
}

interface MergeResult {
  // The merged file with theirs in every conflict: the file a server may write only when `conflicts` is empty.
  merged: SceneFile;
  // The merged file with ours in every conflict: what the editor shows until the user picks a side.
  mine: SceneFile;
  conflicts: Conflict[];
}

type Unit = Record<string, unknown>;

const SETTINGS_KEY = "settings";
const RECORD_ORDER = ["name", "parent", "order", "position", "rotation", "rotationOrder", "scale", "visible", "flags", "components"];
const MATERIAL_ORDER = ["color", "emissive", "emissiveIntensity", "roughness", "metalness"];
const SETTINGS_ORDER = ["background", "environment", "environmentIntensity", "toneMapping", "toneMappingExposure", "shadowMap", "samples", "bloom"];
const COMPONENT_PREFIX = "components.";

// Removes float noise: 15.000000000000002 becomes 15, 0.30000000000000004 becomes 0.3.
// Only a value a few float steps away from a short decimal changes, so the scene stays the same to the bit
// after float32 rounding. Any other value stays exact.
function clean(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const short = Math.round(value * 1e6) / 1e6;
  const tolerance = 4 * Number.EPSILON * Math.abs(value);
  const result = Math.abs(short - value) <= tolerance ? short : value;
  return Object.is(result, -0) ? 0 : result;
}

function isPlainArray(value: unknown[]): boolean {
  return value.every((item) => item === null || typeof item !== "object");
}

// Pretty JSON with small diffs: objects one key per line, arrays of plain values on one line,
// arrays of such arrays one inner array per line. Key order is the insertion order of the writer,
// which is fixed: the serializer always writes the same keys in the same order.
function formatJson(value: unknown, indent = ""): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    if (isPlainArray(value)) {
      return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    }
    return `[\n${value.map((item) => `${inner}${formatJson(item, inner)}`).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
  if (entries.length === 0) {
    return "{}";
  }
  return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${formatJson(item, inner)}`).join(",\n")}\n${indent}}`;
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  const result: Record<string, T> = {};
  for (const key of Object.keys(record).sort()) {
    result[key] = record[key] as T;
  }
  return result;
}

// The file text: settings, then materials sorted by name, then objects sorted by id.
function formatScene(scene: SceneFile): string {
  const file: SceneFile = {
    format: scene.format,
    version: scene.version,
    settings: scene.settings,
    materials: sortKeys(scene.materials),
    objects: sortKeys(scene.objects),
  };
  return `${formatJson(file)}\n`;
}

// A short hash of a text (cyrb53): the same in the browser and in node, without async crypto.
function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

// JSON with sorted keys and without float noise: two values are equal when their canonical texts are equal,
// whatever the key order. 22.587690000000002 (an agent's sum) equals 22.58769 (the editor's cleaned number).
function canonical(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  if (typeof value === "number") {
    return JSON.stringify(clean(value));
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if ((a === undefined || a === null) !== (b === undefined || b === null)) {
    return false;
  }
  return canonical(a) === canonical(b);
}

function absent(value: unknown): boolean {
  return value === undefined || value === null;
}

function unitOf(file: SceneFile, kind: UnitKind, key: string): unknown {
  if (kind === "object") {
    return file.objects[key] ?? null;
  }
  if (kind === "material") {
    return file.materials[key] ?? null;
  }
  return file.settings;
}

function setUnit(file: SceneFile, kind: UnitKind, key: string, value: unknown): void {
  if (kind === "settings") {
    file.settings = value as SceneFile["settings"];
    return;
  }
  const map = (kind === "object" ? file.objects : file.materials) as Record<string, unknown>;
  if (absent(value)) {
    delete map[key];
  } else {
    map[key] = value;
  }
}

// The fields of a unit: its keys, and for an object every component as a field of its own.
function fieldsOf(kind: UnitKind, unit: unknown): string[] {
  if (absent(unit)) {
    return [];
  }
  const record = unit as Unit;
  const fields: string[] = [];
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) {
      continue;
    }
    if (kind === "object" && key === "components") {
      for (const name of Object.keys(record.components as Unit)) {
        fields.push(`${COMPONENT_PREFIX}${name}`);
      }
    } else {
      fields.push(key);
    }
  }
  return fields;
}

function fieldOf(kind: UnitKind, unit: unknown, field: string): unknown {
  if (absent(unit)) {
    return undefined;
  }
  const record = unit as Unit;
  if (kind === "object" && field.startsWith(COMPONENT_PREFIX)) {
    return (record.components as Unit | undefined)?.[field.slice(COMPONENT_PREFIX.length)];
  }
  return record[field];
}

// Builds a unit from field values. Keys go in the order of the writer, then the other keys in the order they came.
function buildUnit(kind: UnitKind, fields: string[], values: Map<string, unknown>): Unit {
  const preferred = kind === "object" ? RECORD_ORDER : kind === "material" ? MATERIAL_ORDER : SETTINGS_ORDER;
  const plain = fields.filter((field) => !(kind === "object" && field.startsWith(COMPONENT_PREFIX)));
  const components = fields.filter((field) => kind === "object" && field.startsWith(COMPONENT_PREFIX));
  const keys = [...preferred.filter((key) => plain.includes(key) || (key === "components" && components.length > 0)), ...plain.filter((key) => !preferred.includes(key))];
  const unit: Unit = {};
  for (const key of keys) {
    if (key === "components" && kind === "object") {
      const data: Unit = {};
      for (const field of components) {
        const value = values.get(field);
        if (value !== undefined) {
          data[field.slice(COMPONENT_PREFIX.length)] = value;
        }
      }
      if (Object.keys(data).length > 0) {
        unit.components = data;
      }
      continue;
    }
    const value = values.get(key);
    if (value !== undefined) {
      unit[key] = value;
    }
  }
  return unit;
}

function unionFields(kind: UnitKind, units: unknown[]): string[] {
  const result: string[] = [];
  for (const unit of units) {
    for (const field of fieldsOf(kind, unit)) {
      if (!result.includes(field)) {
        result.push(field);
      }
    }
  }
  return result;
}

interface UnitMerge {
  // Theirs in every conflict.
  value: unknown;
  // Ours in every conflict.
  mine: unknown;
  conflictFields: string[];
}

function mergeUnit(kind: UnitKind, base: unknown, ours: unknown, theirs: unknown): UnitMerge {
  if (same(ours, base)) {
    return { value: theirs, mine: theirs, conflictFields: [] };
  }
  if (same(theirs, base) || same(theirs, ours)) {
    return { value: ours, mine: ours, conflictFields: [] };
  }
  // Both sides changed the unit. An added, deleted or re-added unit cannot merge by fields.
  if (absent(base) || absent(ours) || absent(theirs)) {
    return { value: theirs, mine: ours, conflictFields: ["*"] };
  }
  // Theirs keeps its own key order; the fields that only ours has come after.
  const fields = unionFields(kind, [theirs, ours, base]);
  const value = new Map<string, unknown>();
  const mine = new Map<string, unknown>();
  const conflictFields: string[] = [];
  for (const field of fields) {
    const b = fieldOf(kind, base, field);
    const o = fieldOf(kind, ours, field);
    const t = fieldOf(kind, theirs, field);
    if (same(o, b)) {
      value.set(field, t);
      mine.set(field, t);
    } else if (same(t, b) || same(t, o)) {
      value.set(field, o);
      mine.set(field, o);
    } else {
      value.set(field, t);
      mine.set(field, o);
      conflictFields.push(field);
    }
  }
  return { value: buildUnit(kind, fields, value), mine: buildUnit(kind, fields, mine), conflictFields };
}

function copyFile(file: SceneFile): SceneFile {
  return { ...file, settings: file.settings, materials: { ...file.materials }, objects: { ...file.objects } };
}

// The units that differ between two files, as the edit from `base` to `next`.
function diffScene(base: SceneFile, next: SceneFile): Change[] {
  const changes: Change[] = [];
  const compare = (kind: UnitKind, a: Record<string, unknown>, b: Record<string, unknown>) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of [...keys].sort()) {
      const before = a[key] ?? null;
      const after = b[key] ?? null;
      if (!same(before, after)) {
        changes.push({ kind, key, base: before, ours: after });
      }
    }
  };
  if (!same(base.settings, next.settings)) {
    changes.push({ kind: "settings", key: SETTINGS_KEY, base: base.settings, ours: next.settings });
  }
  compare("material", base.materials, next.materials);
  compare("object", base.objects, next.objects);
  return changes;
}

// Puts the edit `changes` onto `theirs` (the file on disk now).
function mergeChanges(theirs: SceneFile, changes: Change[]): MergeResult {
  const merged = copyFile(theirs);
  const mine = copyFile(theirs);
  const conflicts: Conflict[] = [];
  for (const change of changes) {
    const current = unitOf(theirs, change.kind, change.key);
    const result = mergeUnit(change.kind, change.base ?? null, change.ours ?? null, current);
    setUnit(merged, change.kind, change.key, result.value);
    setUnit(mine, change.kind, change.key, result.mine);
    if (result.conflictFields.length > 0) {
      conflicts.push({ kind: change.kind, key: change.key, fields: result.conflictFields, base: change.base ?? null, ours: change.ours ?? null, theirs: current });
    }
  }
  return { merged, mine, conflicts };
}

// The unit of a conflict with one side taken for the fields in conflict. `current` is the unit as the editor
// shows it now (ours in the conflict fields, merged elsewhere).
function resolveUnit(conflict: Conflict, current: unknown, side: "ours" | "theirs"): unknown {
  const pick = side === "ours" ? conflict.ours : conflict.theirs;
  if (conflict.fields.includes("*") || absent(current) || absent(pick)) {
    return pick;
  }
  const fields = unionFields(conflict.kind, [current, pick]);
  const values = new Map<string, unknown>();
  for (const field of fields) {
    values.set(field, conflict.fields.includes(field) ? fieldOf(conflict.kind, pick, field) : fieldOf(conflict.kind, current, field));
  }
  return buildUnit(conflict.kind, fields, values);
}

// A short text for a unit: the object id, the material name or "settings".
function describeUnit(kind: UnitKind, key: string): string {
  if (kind === "object") {
    return key;
  }
  if (kind === "material") {
    return `material ${key}`;
  }
  return "settings";
}

export { SETTINGS_KEY, canonical, clean, describeUnit, diffScene, formatJson, formatScene, hashText, mergeChanges, resolveUnit, same, setUnit, unitOf };
export type { Change, Conflict, MergeResult, UnitKind };
