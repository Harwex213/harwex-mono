import type { ReactNode } from "react";
import type { PropField, PropValue } from "../types";

interface FieldRowProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

function FieldRow({ label, hint, children }: FieldRowProps): ReactNode {
  return (
    <label className="tb-field">
      <span className="tb-field__label">
        {label}
        {hint ? <span className="tb-field__hint">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

interface ControlProps {
  field: PropField;
  value: PropValue | undefined;
  onChange: (value: PropValue) => void;
}

function textValue(value: PropValue | undefined): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
}

function numberValue(value: PropValue | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function PropControl({ field, value, onChange }: ControlProps): ReactNode {
  if (field.type === "boolean") {
    return (
      <label className="tb-field tb-field--switch">
        <span className="tb-field__label">{field.label}</span>
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        <span className="tb-switch" aria-hidden="true" />
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <FieldRow label={field.label} hint={field.hint}>
        <select className="tb-input" value={textValue(value)} onChange={(event) => onChange(event.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FieldRow>
    );
  }

  if (field.type === "textarea") {
    return (
      <FieldRow label={field.label} hint={field.hint}>
        <textarea
          className="tb-input tb-input--area"
          rows={3}
          value={textValue(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      </FieldRow>
    );
  }

  if (field.type === "number") {
    return (
      <FieldRow label={field.label} hint={field.hint}>
        <input
          className="tb-input"
          type="number"
          value={textValue(value)}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(event) => onChange(event.target.value === "" ? 0 : Number(event.target.value))}
        />
      </FieldRow>
    );
  }

  if (field.type === "range") {
    const current = numberValue(value, field.min ?? 0);

    return (
      <FieldRow label={field.label} hint={field.hint}>
        <span className="tb-range">
          <input
            type="range"
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            value={current}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <span className="tb-range__value">{current}</span>
        </span>
      </FieldRow>
    );
  }

  if (field.type === "color") {
    return (
      <FieldRow label={field.label} hint={field.hint}>
        <span className="tb-color">
          <input type="color" value={textValue(value) || "#000000"} onChange={(event) => onChange(event.target.value)} />
          <input
            className="tb-input tb-input--mono"
            value={textValue(value)}
            onChange={(event) => onChange(event.target.value)}
          />
        </span>
      </FieldRow>
    );
  }

  return (
    <FieldRow label={field.label} hint={field.hint}>
      <input className="tb-input" value={textValue(value)} onChange={(event) => onChange(event.target.value)} />
    </FieldRow>
  );
}

export { FieldRow, PropControl };
