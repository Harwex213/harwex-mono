import { useFieldCommit } from "./use-field-commit";
import styles from "./fields.module.css";

// A single-line controlled field. It reads and writes the T05 store through the
// `onCommit` callback its parent supplies; it holds no state of its own beyond
// the commit buffer.
//
// NO `useSignals()`: this component reads no signal, and calling it would
// subscribe a component to nothing.
//
// THE CALL SITE MUST PASS A `key` CONTAINING THE TARGET ID, e.g.
// `key={"name-" + country.id}`. Switching the selected target then remounts the
// field and drops any pending draft.

type EditableTextProps = {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
};

function EditableText(props: EditableTextProps) {
  const field = useFieldCommit(props.value, props.onCommit);

  return (
    <label className={styles.field}>
      <span className={styles.caption}>{props.label}</span>
      <input
        className={styles.input}
        disabled={props.disabled === true}
        // Passed through, so the browser stops an over-long paste at the input
        // before `clampText` truncates it silently at the store.
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        type="text"
        value={field.value}
        onBlur={field.onBlur}
        onChange={(event) => {
          field.onChange(event.target.value);
        }}
      />
    </label>
  );
}

export { EditableText, type EditableTextProps };
