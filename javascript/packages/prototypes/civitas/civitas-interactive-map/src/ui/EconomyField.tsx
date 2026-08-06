import { useSignals } from "@preact/signals-react/runtime";
import { fieldAccess, inputStep, parseNumberInput } from "./economics-fields";
import { formatForInput } from "./economics-format";
import { judgeMode } from "../state/economy-store";
import { useFieldCommit } from "./use-field-commit";
import type { DerivedEconomy } from "../economy/types";
import type { EconomySlot } from "../state/economy-store";
import type { FieldTag, NumberSpec } from "./economics-fields";
import styles from "./economics.module.css";

// The tag-aware inputs. Editability comes from the tag and from judge mode, and
// from nowhere else.
//
// A LOCKED FIELD IS A DISABLED INPUT. A disabled input cannot be focused, typed
// into, pasted into or dropped on, so "a player must not be able to edit a [V]
// field by accident" holds structurally rather than through a click handler that
// could be bypassed.
//
// EVERY CALL SITE PASSES A `key` CONTAINING THE COUNTRY ID, per T09/T10's rule.
// Switching country remounts the field and drops the buffered draft, so a draft
// for country 3 can never be committed into country 4.

const LOCK_TITLE = "verdict field — turn on judge mode to change it";

// What every section component receives. The panel reads the two signals once
// and passes plain objects down, so only `EconomicsPanel`, the fields here and
// `EconomyTurn` subscribe to anything.
type SectionProps = {
  slot: EconomySlot;
  derived: DerivedEconomy;
};

type FieldShellProps = {
  // "P" or "V" only. "A" belongs in `Readout`, which has no input at all.
  tag: Exclude<FieldTag, "A">;
  label: string;
  hint?: string;
  // The EXTERNALLY supplied message: `derived.errors` filtered by field name. It
  // shows when the draft itself is fine, which is how a step violation created by
  // a judge lowering the control position — with nothing typed — still surfaces.
  error?: string | null;
  // A reason the field is unavailable regardless of the tag, e.g. a borrow field
  // in default. Spelled out rather than silently accepting a rejected number.
  blocked?: string | null;
};

type NumberFieldProps = FieldShellProps & {
  value: number;
  spec: NumberSpec;
  suffix?: string;
  withRange?: boolean;
  onCommit: (next: number) => void;
};

type SelectFieldProps<T extends string> = FieldShellProps & {
  value: T;
  options: readonly { value: T; label: string }[];
  onCommit: (next: T) => void;
};

type ToggleFieldProps = FieldShellProps & {
  value: boolean;
  onCommit: (next: boolean) => void;
};

type TextFieldProps = FieldShellProps & {
  value: string;
  maxLength?: number;
  placeholder?: string;
  onCommit: (next: string) => void;
};

// A field can be unavailable for a reason that has nothing to do with its tag —
// a borrow field in default, an enterprise field with no action pending. Named,
// because `!editable || blocked !== undefined && blocked !== null` inline reads
// as a precedence puzzle at four call sites.
function isBlocked(blocked: string | null | undefined): boolean {
  return blocked !== undefined && blocked !== null;
}

function Caption(props: { tag: FieldTag; label: string; locked: boolean }) {
  return (
    <span className={styles.caption}>
      <span
        className={styles.tag}
        data-tag={props.tag}
        title={props.tag === "P" ? "player — you set it directly" : "verdict — a judge sets it"}
      >
        {props.tag}
      </span>
      <span className={styles.captionText}>{props.label}</span>
      {props.locked ? (
        <span className={styles.lock} title={LOCK_TITLE}>
          locked
        </span>
      ) : null}
    </span>
  );
}

function NumberField(props: NumberFieldProps) {
  useSignals();

  const access = fieldAccess(props.tag, judgeMode.value);
  const disabled = !access.editable || isBlocked(props.blocked);

  const text = formatForInput(props.value, props.spec.decimals);
  const field = useFieldCommit(text, (next) => {
    const parsed = parseNumberInput(next, props.spec);
    if (!parsed.ok) {
      // REJECTED. Nothing is written. `useFieldCommit` clears its draft after the
      // commit window, so the input snaps back to the last committed number —
      // the panel refuses the edit instead of silently clamping it, which is what
      // spec 12 requires of the step cap.
      return;
    }
    props.onCommit(parsed.value);
  });

  const live = parseNumberInput(field.value, props.spec);
  const message = live.ok ? props.error ?? null : live.reason;
  const invalid = !live.ok;

  return (
    <label className={styles.field} data-locked={access.locked} data-tag={props.tag}>
      <Caption label={props.label} locked={access.locked} tag={props.tag} />
      <span className={styles.inputRow}>
        <input
          className={styles.input}
          aria-invalid={invalid}
          data-invalid={invalid}
          disabled={disabled}
          // The browser's own spinner and validation then agree with
          // `parseNumberInput` rather than contradicting it.
          max={props.spec.max}
          min={props.spec.min}
          step={inputStep(props.spec)}
          title={access.locked ? LOCK_TITLE : undefined}
          type="number"
          value={field.value}
          onBlur={field.onBlur}
          onChange={(event) => {
            field.onChange(event.target.value);
          }}
        />
        {props.suffix === undefined ? null : (
          <span className={styles.suffix}>{props.suffix}</span>
        )}
      </span>
      {/* The range is for feel, the number above it for precision. Both commit
          through the same handler. */}
      {props.withRange === true ? (
        <input
          className={styles.range}
          disabled={disabled}
          max={props.spec.max}
          min={props.spec.min}
          step={inputStep(props.spec)}
          type="range"
          value={String(props.value)}
          onChange={(event) => {
            const parsed = parseNumberInput(event.target.value, props.spec);
            if (!parsed.ok) {
              return;
            }
            props.onCommit(parsed.value);
          }}
        />
      ) : null}
      {isBlocked(props.blocked) ? (
        <span className={styles.message}>{props.blocked}</span>
      ) : null}
      {message === null ? null : <span className={styles.message}>{message}</span>}
      {props.hint === undefined ? null : <span className={styles.hint}>{props.hint}</span>}
    </label>
  );
}

function SelectField<T extends string>(props: SelectFieldProps<T>) {
  useSignals();

  const access = fieldAccess(props.tag, judgeMode.value);
  const disabled = !access.editable || isBlocked(props.blocked);

  return (
    <label className={styles.field} data-locked={access.locked} data-tag={props.tag}>
      <Caption label={props.label} locked={access.locked} tag={props.tag} />
      <select
        className={styles.select}
        disabled={disabled}
        title={access.locked ? LOCK_TITLE : undefined}
        value={props.value}
        onChange={(event) => {
          props.onCommit(event.target.value as T);
        }}
      >
        {props.options.map((option) => {
          return (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          );
        })}
      </select>
      {isBlocked(props.blocked) ? (
        <span className={styles.message}>{props.blocked}</span>
      ) : null}
      {props.error === undefined || props.error === null ? null : (
        <span className={styles.message}>{props.error}</span>
      )}
      {props.hint === undefined ? null : <span className={styles.hint}>{props.hint}</span>}
    </label>
  );
}

function ToggleField(props: ToggleFieldProps) {
  useSignals();

  const access = fieldAccess(props.tag, judgeMode.value);
  const disabled = !access.editable || isBlocked(props.blocked);

  return (
    <label className={styles.field} data-locked={access.locked} data-tag={props.tag}>
      <Caption label={props.label} locked={access.locked} tag={props.tag} />
      <span className={styles.inputRow}>
        <input
          className={styles.checkbox}
          checked={props.value}
          disabled={disabled}
          title={access.locked ? LOCK_TITLE : undefined}
          type="checkbox"
          onChange={(event) => {
            props.onCommit(event.target.checked);
          }}
        />
        <span className={styles.suffix}>{props.value ? "yes" : "no"}</span>
      </span>
      {props.error === undefined || props.error === null ? null : (
        <span className={styles.message}>{props.error}</span>
      )}
      {props.hint === undefined ? null : <span className={styles.hint}>{props.hint}</span>}
    </label>
  );
}

function TextField(props: TextFieldProps) {
  useSignals();

  const access = fieldAccess(props.tag, judgeMode.value);
  const disabled = !access.editable || isBlocked(props.blocked);
  const field = useFieldCommit(props.value, props.onCommit);

  return (
    <label className={styles.field} data-locked={access.locked} data-tag={props.tag}>
      <Caption label={props.label} locked={access.locked} tag={props.tag} />
      <input
        className={styles.input}
        disabled={disabled}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        title={access.locked ? LOCK_TITLE : undefined}
        type="text"
        value={field.value}
        onBlur={field.onBlur}
        onChange={(event) => {
          field.onChange(event.target.value);
        }}
      />
      {props.error === undefined || props.error === null ? null : (
        <span className={styles.message}>{props.error}</span>
      )}
      {props.hint === undefined ? null : <span className={styles.hint}>{props.hint}</span>}
    </label>
  );
}

// The panel's field-level error lookup. `derived.errors` carries an engine field
// path; a field asks for its own.
function errorFor(derived: DerivedEconomy, field: string): string | null {
  for (const error of derived.errors) {
    if (error.field === field) {
      return error.code + ": " + error.message;
    }
  }
  return null;
}

export {
  NumberField,
  SelectField,
  TextField,
  ToggleField,
  errorFor,
  type NumberFieldProps,
  type SectionProps,
  type SelectFieldProps,
  type TextFieldProps,
  type ToggleFieldProps,
};
