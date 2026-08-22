import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import type { SchemaGroup } from "../schema";
import { BUILDINGS_GROUP, DEFAULTS, entityEntries, fieldEntries, groupEntries } from "../schema";
import type { EntityDescriptor, Field } from "../types";
import { BuildingsGraph } from "./BuildingsGraph";
import { FieldRow } from "./FieldRow";
import { hrefOf, page, startRouter } from "./router";
import {
  dirty,
  dirtyGroups,
  exportJson,
  groupIsDefault,
  importJson,
  loadFromDisk,
  loaded,
  read,
  resetAll,
  resetField,
  resetGroup,
  save,
  saving,
  status,
  values,
} from "./state";

/**
 * The editor shell: a sticky toolbar and nav on top, one page per schema group
 * below. Every control on every page comes from `FieldRow`, so a schema entry
 * is the only thing a new knob needs.
 */

function groupAt(name: string): SchemaGroup {
  const found = groupEntries().find(([key]) => key === name);
  return found![1];
}

/** Fields of one owner that differ from the schema defaults. */
function changedFields(group: SchemaGroup, owner: string): string[] {
  return fieldEntries(group)
    .filter(([key]) => read(values.value, owner, key) !== read(DEFAULTS, owner, key))
    .map(([key]) => key);
}

type FieldsProps = {
  group: SchemaGroup;
  owner: string;
};

function Fields({ group, owner }: FieldsProps): React.JSX.Element {
  return (
    <div className="fields">
      {fieldEntries(group).map(([key, field]: [string, Field]) => (
        <FieldRow key={key} owner={owner} name={key} field={field} />
      ))}
    </div>
  );
}

/** One entity of a collection: the same field template, filled in. */
function EntityCard({ group, name, entityKey, entity }: {
  group: SchemaGroup;
  name: string;
  entityKey: string;
  entity: EntityDescriptor;
}): React.JSX.Element {
  useSignals();
  const owner = `${name}.${entityKey}`;
  const changed = changedFields(group, owner);

  return (
    <article className="entity">
      <header className="entity-head">
        <h3>{entity.label}</h3>
        <span className="muted mono">{owner}</span>
        <span className="muted entity-state">
          {changed.length > 0 ? `${changed.length} изменено` : "как по умолчанию"}
        </span>
      </header>
      <Fields group={group} owner={owner} />
      <button
        type="button"
        className="link entity-reset"
        disabled={changed.length === 0}
        onClick={() => {
          for (const key of changed) {
            resetField(owner, key);
          }
        }}
      >
        сбросить {entity.label}
      </button>
    </article>
  );
}

function Page({ name }: { name: string }): React.JSX.Element {
  useSignals();
  const group = groupAt(name);
  const entities = entityEntries(group);

  return (
    <section className="section" id={`page-${name}`}>
      <header className="section-head">
        <h2>{group.label}</h2>
      </header>
      {name === BUILDINGS_GROUP ? (
        <BuildingsGraph />
      ) : entities ? (
        <div className="entities">
          <p className="entity-kind muted">
            {group.entityLabel ?? "Сущность"} · {entities.length} шт., поля общие для всех
          </p>
          {entities.map(([entityKey, entity]) => (
            <EntityCard key={entityKey} group={group} name={name} entityKey={entityKey} entity={entity} />
          ))}
        </div>
      ) : (
        <Fields group={group} owner={name} />
      )}
      <button
        type="button"
        className="link section-reset"
        disabled={groupIsDefault(name)}
        onClick={() => resetGroup(name)}
      >
        сбросить страницу к значениям по умолчанию
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

function Nav(): React.JSX.Element {
  useSignals();
  const current = page.value;
  const marks = dirtyGroups.value;

  return (
    <nav className="nav">
      {groupEntries().map(([name, group]) => (
        <a
          key={name}
          className={name === current ? "active" : ""}
          href={hrefOf(name)}
          aria-current={name === current ? "page" : undefined}
        >
          {group.label}
          {marks[name] === true ? <i className="dot" title="На странице есть несохранённые правки" /> : null}
        </a>
      ))}
    </nav>
  );
}

function Editor(): React.JSX.Element {
  useSignals();

  useEffect(() => {
    void loadFromDisk();
  }, []);

  useEffect(() => startRouter(), []);

  return (
    <div className="editor">
      <div className="chrome">
        <Toolbar />
        <Nav />
      </div>
      <main className="body">
        {loaded.value ? null : <p className="muted">Читаю конфиг с диска…</p>}
        <Page name={page.value} />
      </main>
    </div>
  );
}

export { Editor };
