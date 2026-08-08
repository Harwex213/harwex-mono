import { computed, signal } from "@preact/signals-react";
import type { GameConfig } from "../schema";
import { DEFAULTS, cloneConfig, validateConfig } from "../schema";
import type { ConfigValue } from "../types";

/**
 * Editor state. The values shown in the form live here; the copy last known to
 * be on disk lives next to them, which is what "изменено" and the reload-from-
 * disk check compare against.
 */

const ENDPOINT = "/api/config";

const POLL_INTERVAL_MS = 2000;

type Status = {
  kind: "ok" | "error" | "info";
  text: string;
};

type MutableConfig = Record<string, Record<string, ConfigValue>>;

const values = signal<GameConfig>(cloneConfig(DEFAULTS));
const onDisk = signal<GameConfig>(cloneConfig(DEFAULTS));
const loaded = signal(false);
const saving = signal(false);
const status = signal<Status | null>(null);

const dirty = computed(() => JSON.stringify(values.value) !== JSON.stringify(onDisk.value));

function read(config: GameConfig, group: string, field: string): ConfigValue {
  return (config as unknown as MutableConfig)[group]![field]!;
}

function setField(group: string, field: string, value: ConfigValue): void {
  const next = cloneConfig(values.peek()) as unknown as MutableConfig;
  next[group]![field] = value;
  values.value = next as unknown as GameConfig;
}

function resetField(group: string, field: string): void {
  setField(group, field, read(DEFAULTS, group, field));
}

function resetAll(): void {
  values.value = cloneConfig(DEFAULTS);
  status.value = { kind: "info", text: "Все поля сброшены к значениям по умолчанию. Не забудьте сохранить." };
}

function replaceAll(next: GameConfig): void {
  values.value = cloneConfig(next);
}

/** Reads the file the dev server holds and adopts it as the on-disk copy. */
async function loadFromDisk(quiet: boolean): Promise<void> {
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
    const first = !loaded.peek();
    const changedOnDisk = JSON.stringify(parsed.value) !== JSON.stringify(onDisk.peek());
    const hasEdits = dirty.peek();
    loaded.value = true;
    if (!first && !changedOnDisk) {
      return;
    }
    onDisk.value = parsed.value;
    if (first || !hasEdits) {
      values.value = cloneConfig(parsed.value);
      if (!first) {
        status.value = { kind: "info", text: "Файл изменился на диске — форма обновлена." };
      }
      return;
    }
    status.value = { kind: "info", text: "Файл изменился на диске, но в форме есть несохранённые правки." };
  } catch (error) {
    loaded.value = true;
    if (quiet) {
      return;
    }
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

/** Picks up edits made to the file by anything other than this tab. */
function startDiskWatch(): () => void {
  const timer = window.setInterval(() => {
    if (saving.peek()) {
      return;
    }
    void loadFromDisk(true);
  }, POLL_INTERVAL_MS);
  return () => {
    window.clearInterval(timer);
  };
}

export type { Status };
export {
  dirty,
  exportJson,
  importJson,
  loadFromDisk,
  loaded,
  onDisk,
  read,
  resetAll,
  resetField,
  save,
  saving,
  setField,
  startDiskWatch,
  status,
  values,
};
