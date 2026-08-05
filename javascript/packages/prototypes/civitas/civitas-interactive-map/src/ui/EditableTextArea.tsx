import { useFieldCommit } from "./use-field-commit";
import styles from "./fields.module.css";

// The multiline sibling of `EditableText`, for lore. Same hook, same key rule:
// the call site passes a `key` containing the target id, or a pending draft for
// one country is committed into the next.

const DEFAULT_ROWS = 6;

type EditableTextAreaProps = {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  // REPLACES `styles.area`, it does not add to it. Two single-class selectors
  // from two different CSS modules have equal specificity, so which one wins
  // depends on the order rspack happens to emit the modules in. Replacing is
  // deterministic; appending is a coin flip that looks fine until a rebuild.
  // The same rule and the same wording T09 established for `previewClassName`.
  areaClassName?: string;
};

function EditableTextArea(props: EditableTextAreaProps) {
  const field = useFieldCommit(props.value, props.onCommit);

  return (
    <label className={styles.field}>
      <span className={styles.caption}>{props.label}</span>
      <textarea
        className={props.areaClassName ?? styles.area}
        disabled={props.disabled === true}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        rows={props.rows ?? DEFAULT_ROWS}
        value={field.value}
        onBlur={field.onBlur}
        onChange={(event) => {
          field.onChange(event.target.value);
        }}
      />
    </label>
  );
}

export { EditableTextArea, type EditableTextAreaProps };
