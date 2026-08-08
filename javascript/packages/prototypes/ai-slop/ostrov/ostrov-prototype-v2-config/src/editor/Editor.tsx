import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import { DEFAULTS, SCHEMA } from "../schema";
import type { Field } from "../types";
import { FieldRow } from "./FieldRow";
import {
  dirty,
  exportJson,
  importJson,
  loadFromDisk,
  loaded,
  read,
  resetAll,
  resetField,
  save,
  saving,
  startDiskWatch,
  status,
  values,
} from "./state";

type GroupEntry = [string, { label: string; description: string; fields: Record<string, Field> }];

function groups(): GroupEntry[] {
  return Object.entries(SCHEMA) as GroupEntry[];
}

function Section({ name }: { name: string }): React.JSX.Element {
  useSignals();
  const group = (SCHEMA as unknown as Record<string, GroupEntry[1]>)[name]!;
  const fields = Object.entries(group.fields);
  const changed = fields.filter(([key]) => read(values.value, name, key) !== read(DEFAULTS, name, key));

  return (
    <section className="section" id={`group-${name}`}>
      <header className="section-head">
        <h2>{group.label}</h2>
        <span className="muted">{changed.length > 0 ? `${changed.length} изменено` : "как по умолчанию"}</span>
      </header>
      <p className="section-note">{group.description}</p>
      <div className="fields">
        {fields.map(([key, field]) => (
          <FieldRow key={key} group={name} name={key} field={field} />
        ))}
      </div>
      <button
        type="button"
        className="link section-reset"
        disabled={changed.length === 0}
        onClick={() => {
          for (const [key] of changed) {
            resetField(name, key);
          }
        }}
      >
        сбросить группу
      </button>
    </section>
  );
}

function Toolbar(): React.JSX.Element {
  useSignals();
  const fileRef = useRef<HTMLInputElement>(null);
  const state = status.value;

  return (
    <header className="toolbar">
      <div className="brand">
        <h1>Остров — конфиг</h1>
        <span className="muted mono">data/config.json</span>
      </div>
      <div className="actions">
        <span className={dirty.value ? "badge dirty" : "badge"}>{dirty.value ? "есть правки" : "совпадает с диском"}</span>
        <button type="button" className="primary" disabled={!dirty.value || saving.value} onClick={() => void save()}>
          {saving.value ? "Сохраняю…" : "Сохранить"}
        </button>
        <button type="button" onClick={resetAll}>
          Сбросить всё
        </button>
        <button type="button" onClick={exportJson}>
          Экспорт
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Импорт
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) {
              return;
            }
            void file.text().then(importJson);
          }}
        />
      </div>
      {state ? (
        <p className={`status ${state.kind}`} role="status">
          {state.text}
        </p>
      ) : null}
    </header>
  );
}

function Editor(): React.JSX.Element {
  useSignals();

  useEffect(() => {
    void loadFromDisk(false);
    return startDiskWatch();
  }, []);

  return (
    <div className="editor">
      <Toolbar />
      <nav className="nav">
        {groups().map(([name, group]) => (
          <a key={name} href={`#group-${name}`}>
            {group.label}
          </a>
        ))}
      </nav>
      <main className="body">
        {loaded.value ? null : <p className="muted">Читаю конфиг с диска…</p>}
        {groups().map(([name]) => (
          <Section key={name} name={name} />
        ))}
      </main>
    </div>
  );
}

export { Editor };
