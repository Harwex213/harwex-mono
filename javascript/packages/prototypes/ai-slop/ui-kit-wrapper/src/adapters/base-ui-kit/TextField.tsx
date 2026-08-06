import { Field } from "@hw/ui-kit-over-base-ui/src/ui/field/Field";
import { Input } from "@hw/ui-kit-over-base-ui/src/ui/input/Input";
import type { TextFieldProps } from "../../ui/contract";
import styles from "./adapter.module.css";

/**
 * One contract component, four kit parts.
 *
 * This is the usual shape of adapter work: the kit exposes an anatomy
 * (Root / Label / control / Error) and the contract exposes a job ("a labelled
 * text field with an error message"). Composing the anatomy here means the app
 * never learns it, so the next kit is free to have a completely different one.
 *
 * `error` is a string, not a validity rule. The kit can validate on its own via
 * `Field.Root validate`, but wiring that into the contract would force every
 * future kit to have a compatible validation engine. Validation stays in the
 * app; the kit only shows the message.
 */
function TextField({
  label,
  value,
  onValueChange,
  type = "text",
  placeholder,
  hint,
  error,
  disabled = false,
  required = false,
}: TextFieldProps) {
  return (
    <Field.Root className={styles.field} disabled={disabled} invalid={Boolean(error)}>
      <Field.Label>
        {label}
        {required ? <span className={styles.required}>*</span> : null}
      </Field.Label>
      <Input.Root
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        onValueChange={(next) => onValueChange(next)}
      />
      {hint && !error ? <Field.Description>{hint}</Field.Description> : null}
      {error ? <Field.Error match>{error}</Field.Error> : null}
    </Field.Root>
  );
}

export { TextField };
