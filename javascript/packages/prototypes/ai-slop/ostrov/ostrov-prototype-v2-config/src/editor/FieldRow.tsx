import { useSignals } from "@preact/signals-react/runtime";
import { useRef, useState } from "react";
import { DEFAULTS, stepOf } from "../schema";
import type { ConfigValue, Field, NumberField } from "../types";
import { ResourceIcon, iconOfField } from "./icons";
import { read, resetField, setField, values } from "./state";

/**
 * One schema field rendered as a labelled control. Every control in the editor
 * comes through here — nothing is hand-written per value.
 */

type FieldRowProps = {
  /** `"hex"` for a plain group, `"buildings.castle1"` for one entity of a collection. */
  owner: string;
  name: string;
  field: Field;
};

function formatValue(value: ConfigValue): string {
  if (typeof value === "number") {
    return String(Number(value.toFixed(6)));
  }
  return String(value);
}

/** Number of decimals a slider step implies, so typing does not fight rounding. */
function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number(value.toFixed(Math.min(10, decimals)));
}

type NumberControlProps = {
  owner: string;
  name: string;
  field: NumberField;
};

function NumberControl({ owner, name, field }: NumberControlProps): React.JSX.Element {
  const current = read(values.value, owner, name) as number;
  const step = stepOf(field);
  /**
   * Text of an edit in progress. `null` means the box just shows the committed
   * value, so a slider drag or a reset elsewhere is reflected right away. A
   * typed edit only reaches the config on blur or Enter: committing per
   * keystroke clamps a half-typed number and makes direct entry impossible.
   */
  const [draft, setDraft] = useState<string | null>(null);
  /**
   * The same text, readable at once. Escape drops the edit and then blurs, and
   * the blur handler runs before React has applied the state update, so it has
   * to ask the ref whether an edit is still pending.
   */
  const draftRef = useRef<string | null>(draft);
  const putDraft = (next: string | null): void => {
    draftRef.current = next;
    setDraft(next);
  };
  const commit = (raw: number): void => {
    if (!Number.isFinite(raw)) {
      return;
    }
    const clamped = Math.min(field.max, Math.max(field.min, raw));
    setField(owner, name, field.type === "int" ? Math.round(clamped) : roundToStep(clamped, step));
  };
  /** Applies the typed text, or drops it when it is empty or not a number. */
  const commitDraft = (): void => {
    const pending = draftRef.current;
    if (pending === null) {
      return;
    }
    const text = pending.trim();
    const parsed = Number(text);
    putDraft(null);
    if (text !== "" && Number.isFinite(parsed)) {
      commit(parsed);
    }
  };
  const commitSlider = (raw: number): void => {
    putDraft(null);
    commit(raw);
  };
  return (
    <div className="control number">
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={step}
        value={current}
        onChange={(event) => commitSlider(event.currentTarget.valueAsNumber)}
      />
      <input
        type="number"
        className="number-input"
        min={field.min}
        max={field.max}
        step={step}
        value={draft ?? formatValue(current)}
        onChange={(event) => putDraft(event.currentTarget.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commitDraft();
            return;
          }
          if (event.key === "Escape") {
            putDraft(null);
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

function Control({ owner, name, field }: FieldRowProps): React.JSX.Element {
  const current = read(values.value, owner, name);
  if (field.type === "boolean") {
    return (
      <div className="control">
        <label className="switch">
          <input
            type="checkbox"
            checked={current === true}
            onChange={(event) => setField(owner, name, event.currentTarget.checked)}
          />
          <span>{current === true ? "включено" : "выключено"}</span>
        </label>
      </div>
    );
  }
  if (field.type === "color") {
    return (
      <div className="control">
        <input
          type="color"
          value={String(current)}
          onChange={(event) => setField(owner, name, event.currentTarget.value.toLowerCase())}
        />
        <input
          type="text"
          className="text-input mono"
          value={String(current)}
          spellCheck={false}
          onChange={(event) => setField(owner, name, event.currentTarget.value.trim().toLowerCase())}
        />
      </div>
    );
  }
  if (field.type === "enum") {
    return (
      <div className="control">
        <select value={String(current)} onChange={(event) => setField(owner, name, event.currentTarget.value)}>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (field.type === "string") {
    return (
      <div className="control">
        <input
          type="text"
          className="text-input wide"
          value={String(current)}
          maxLength={field.maxLength ?? 64}
          onChange={(event) => setField(owner, name, event.currentTarget.value)}
        />
      </div>
    );
  }
  return <NumberControl owner={owner} name={name} field={field} />;
}

function FieldRow({ owner, name, field }: FieldRowProps): React.JSX.Element {
  useSignals();
  const current = read(values.value, owner, name);
  const fallback = read(DEFAULTS, owner, name);
  const changed = current !== fallback;
  const icon = iconOfField(name);

  return (
    <div className={changed ? "field changed" : "field"}>
      <div className="field-head">
        <span className="field-label">
          {icon ? <ResourceIcon kind={icon} /> : null}
          {field.label}
          {changed ? <i className="dot" title="Отличается от значения по умолчанию" /> : null}
        </span>
        <span className="field-key mono">{`${owner}.${name}`}</span>
      </div>
      <Control owner={owner} name={name} field={field} />
      <div className="field-foot">
        {field.type === "int" || field.type === "number" ? (
          <span className="muted mono">{`${field.min}…${field.max}`}</span>
        ) : null}
        <button type="button" className="link" disabled={!changed} onClick={() => resetField(owner, name)}>
          сбросить
        </button>
      </div>
    </div>
  );
}

export { FieldRow };
