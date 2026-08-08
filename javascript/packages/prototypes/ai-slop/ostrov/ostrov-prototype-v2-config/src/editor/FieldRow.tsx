import { useSignals } from "@preact/signals-react/runtime";
import { DEFAULTS, stepOf } from "../schema";
import type { ConfigValue, Field, NumberField } from "../types";
import { read, resetField, setField, values } from "./state";

/**
 * One schema field rendered as a labelled control. Every control in the editor
 * comes through here — nothing is hand-written per value.
 */

type FieldRowProps = {
  group: string;
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
  group: string;
  name: string;
  field: NumberField;
};

function NumberControl({ group, name, field }: NumberControlProps): React.JSX.Element {
  const current = read(values.value, group, name) as number;
  const step = stepOf(field);
  const commit = (raw: number): void => {
    if (!Number.isFinite(raw)) {
      return;
    }
    const clamped = Math.min(field.max, Math.max(field.min, raw));
    setField(group, name, field.type === "int" ? Math.round(clamped) : roundToStep(clamped, step));
  };
  return (
    <div className="control number">
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={step}
        value={current}
        onChange={(event) => commit(event.currentTarget.valueAsNumber)}
      />
      <input
        type="number"
        className="number-input"
        min={field.min}
        max={field.max}
        step={step}
        value={current}
        onChange={(event) => commit(event.currentTarget.valueAsNumber)}
      />
    </div>
  );
}

function Control({ group, name, field }: FieldRowProps): React.JSX.Element {
  const current = read(values.value, group, name);
  if (field.type === "boolean") {
    return (
      <div className="control">
        <label className="switch">
          <input
            type="checkbox"
            checked={current === true}
            onChange={(event) => setField(group, name, event.currentTarget.checked)}
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
          onChange={(event) => setField(group, name, event.currentTarget.value.toLowerCase())}
        />
        <input
          type="text"
          className="text-input mono"
          value={String(current)}
          spellCheck={false}
          onChange={(event) => setField(group, name, event.currentTarget.value.trim().toLowerCase())}
        />
      </div>
    );
  }
  if (field.type === "enum") {
    return (
      <div className="control">
        <select value={String(current)} onChange={(event) => setField(group, name, event.currentTarget.value)}>
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
          onChange={(event) => setField(group, name, event.currentTarget.value)}
        />
      </div>
    );
  }
  return <NumberControl group={group} name={name} field={field} />;
}

function FieldRow({ group, name, field }: FieldRowProps): React.JSX.Element {
  useSignals();
  const current = read(values.value, group, name);
  const fallback = read(DEFAULTS, group, name);
  const changed = current !== fallback;

  return (
    <div className={changed ? "field changed" : "field"}>
      <div className="field-head">
        <span className="field-label">
          {field.label}
          {changed ? <i className="dot" title="Отличается от значения по умолчанию" /> : null}
        </span>
        <span className="field-key mono">{`${group}.${name}`}</span>
      </div>
      <p className="field-note">{field.description}</p>
      <Control group={group} name={name} field={field} />
      <div className="field-foot">
        <span className="muted mono">
          по умолчанию: {formatValue(fallback)}
          {field.type === "int" || field.type === "number" ? ` · ${field.min}…${field.max}` : ""}
        </span>
        <button type="button" className="link" disabled={!changed} onClick={() => resetField(group, name)}>
          сбросить
        </button>
      </div>
    </div>
  );
}

export { FieldRow };
