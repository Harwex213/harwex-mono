import { computed, signal } from "@preact/signals-react";
import type { GameConfig } from "../schema";
import { DEFAULTS, cloneConfig, groupEntries, validateConfig } from "../schema";
import type { ConfigValue } from "../types";

/**
 * Editor state. The values shown in the form live here; the copy last known to
 * be on disk lives next to them, which is what "изменено" and the reload-from-
 * disk check compare against.
 *
 * The buffer holds the whole config, not the page in view, so edits survive
 * navigation and one Save writes every page at once.
 */

const ENDPOINT = "/api/config";

type Status = {
  kind: "ok" | "error" | "info";
  text: string;
};

type MutableEntity = Record<string, ConfigValue>;

type MutableGroup = Record<string, ConfigValue | MutableEntity>;

type MutableConfig = Record<string, MutableGroup>;

const values = signal<GameConfig>(cloneConfig(DEFAULTS));
const onDisk = signal<GameConfig>(cloneConfig(DEFAULTS));
const loaded = signal(false);
const saving = signal(false);
const status = signal<Status | null>(null);

const dirty = computed(() => JSON.stringify(values.value) !== JSON.stringify(onDisk.value));

/** Which pages hold unsaved edits, so the nav can mark them. */
const dirtyGroups = computed(() => {
  const current = values.value as unknown as MutableConfig;
  const saved = onDisk.value as unknown as MutableConfig;
  const result: Record<string, boolean> = {};
  for (const [groupKey] of groupEntries()) {
    result[groupKey] = JSON.stringify(current[groupKey]) !== JSON.stringify(saved[groupKey]);
  }
  return result;
});

/**
 * Resolves an owner path to the object that holds the fields: `"hex"` for a
 * plain group, `"buildings.castle1"` for one entity of a collection.
 */
function ownerAt(config: MutableConfig, owner: string): MutableEntity {
  const [groupKey, entityKey] = owner.split(".");
  const group = config[groupKey!]!;
  if (entityKey === undefined) {
    return group as MutableEntity;
  }
  return group[entityKey] as MutableEntity;
}

function read(config: GameConfig, owner: string, field: string): ConfigValue {
  return ownerAt(config as unknown as MutableConfig, owner)[field]!;
}

function setField(owner: string, field: string, value: ConfigValue): void {
  const next = cloneConfig(values.peek()) as unknown as MutableConfig;
  ownerAt(next, owner)[field] = value;
  values.value = next as unknown as GameConfig;
}

function resetField(owner: string, field: string): void {
  setField(owner, field, read(DEFAULTS, owner, field));
}

/** True when nothing in the group differs from the schema defaults. */
function groupIsDefault(groupKey: string): boolean {
  const current = (values.value as unknown as MutableConfig)[groupKey];
  const fallback = (DEFAULTS as unknown as MutableConfig)[groupKey];
  return JSON.stringify(current) === JSON.stringify(fallback);
}

/** Puts one whole group — plain or collection — back to its schema defaults. */
function resetGroup(groupKey: string): void {
  const next = cloneConfig(values.peek()) as unknown as MutableConfig;
  const fallback = cloneConfig(DEFAULTS) as unknown as MutableConfig;
  next[groupKey] = fallback[groupKey]!;
  values.value = next as unknown as GameConfig;
}

function resetAll(): void {
  values.value = cloneConfig(DEFAULTS);
  status.value = { kind: "info", text: "Все поля сброшены к значениям по умолчанию. Не забудьте сохранить." };
}

function replaceAll(next: GameConfig): void {
  values.value = cloneConfig(next);
}

/**
 * Reads the file the dev server holds and adopts it as the on-disk copy. Run
 * once, when the editor mounts.
 *
 * Nothing re-reads the file afterwards. A poll has to choose between two bad
 * moments: overwriting a form the user is filling in, or replacing it silently
 * while they look away. Reading once means the form only ever changes because
 * the user changed it.
 */
async function loadFromDisk(): Promise<void> {
  try {
    const response = await fetch(ENDPOINT, { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`сервер ответил ${response.status}`);
    }
    const payload = (await response.json()) as { values?: unknown };
    const parsed = validateConfig(payload.values);
    if (!parsed.ok) {
      throw new Error(parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    }
    onDisk.value = parsed.value;
    values.value = cloneConfig(parsed.value);
    loaded.value = true;
  } catch (error) {
    loaded.value = true;
    status.value = { kind: "error", text: `Не удалось прочитать конфиг: ${String(error)}` };
  }
}

async function save(): Promise<void> {
  if (saving.peek()) {
    return;
  }
  saving.value = true;
  const payload = cloneConfig(values.peek());
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => null)) as { issues?: { path: string; message: string }[] } | null;
    if (!response.ok) {
      const details = body?.issues?.map((issue) => `${issue.path}: ${issue.message}`).join("; ") ?? `HTTP ${response.status}`;
      status.value = { kind: "error", text: `Сохранение отклонено (${response.status}): ${details}` };
      return;
    }
    onDisk.value = payload;
    status.value = { kind: "ok", text: `Записано в data/config.json в ${new Date().toLocaleTimeString()}.` };
  } catch (error) {
    status.value = { kind: "error", text: `Сохранение не удалось: ${String(error)}` };
  } finally {
    saving.value = false;
  }
}

function exportJson(): void {
  const text = `${JSON.stringify(values.peek(), null, 2)}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "ostrov-config.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importJson(text: string): void {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    status.value = { kind: "error", text: `Не JSON: ${String(error)}` };
    return;
  }
  const parsed = validateConfig(raw);
  if (!parsed.ok) {
    status.value = {
      kind: "error",
      text: `Файл не проходит валидацию: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
    };
    return;
  }
  replaceAll(parsed.value);
  status.value = { kind: "info", text: "Импортировано. Нажмите «Сохранить», чтобы записать на диск." };
}

export type { Status };
export {
  dirty,
  dirtyGroups,
  exportJson,
  groupIsDefault,
  importJson,
  loadFromDisk,
  loaded,
  onDisk,
  read,
  resetAll,
  resetField,
  resetGroup,
  save,
  saving,
  setField,
  status,
  values,
};
