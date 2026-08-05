import styles from "./economics.module.css";

// An [A] cell. The engine computed it and nothing in the panel may change it.
//
// THIS FILE CONTAINS NO `<input>`, NO `<select>` AND NO `contentEditable`. That
// is the structural half of "[A] fields must never be editable" — there is no
// code path through which one of them becomes an input, in either mode. The
// other half is `fieldAccess`, which returns `auto` for tag "A" whether judge
// mode is on or off.
//
// No `useSignals()`: this component reads no signal.

type ReadoutTone = "normal" | "good" | "bad" | "muted";

type ReadoutProps = {
  label: string;
  value: string;
  tone?: ReadoutTone;
  hint?: string;
};

function Readout(props: ReadoutProps) {
  return (
    <div className={styles.readout}>
      <span className={styles.readoutLabel}>
        <span className={styles.tag} data-tag="A" title="auto — the engine computes it">
          A
        </span>
        <span className={styles.captionText}>{props.label}</span>
      </span>
      {/* `tone` drives an attribute only. The colour lives in the CSS module and
          comes from the theme tokens. */}
      <span className={styles.readoutValue} data-tone={props.tone ?? "normal"} title={props.value}>
        {props.value}
      </span>
      {props.hint === undefined ? null : <span className={styles.readoutHint}>{props.hint}</span>}
    </div>
  );
}

export { Readout, type ReadoutProps, type ReadoutTone };
