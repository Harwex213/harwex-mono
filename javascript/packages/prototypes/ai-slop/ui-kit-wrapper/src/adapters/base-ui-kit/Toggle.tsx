import { Switch } from "@hw/ui-kit-over-base-ui/src/ui/switch/Switch";
import type { ToggleProps } from "../../ui/contract";
import styles from "./toggle.module.css";

/**
 * The kit ships a bare switch: Root plus Thumb, no label, no hint. Its own demo
 * wraps it in a hand-rolled `<label>` with inline styles.
 *
 * That wrapping is exactly the code that would otherwise be copy-pasted into
 * every screen and would have to be found and rewritten at swap time. It lives
 * here once instead.
 */
function Toggle({ label, checked, onCheckedChange, hint, disabled = false }: ToggleProps) {
  return (
    <label className={styles.toggle}>
      <Switch.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next)}
      >
        <Switch.Thumb />
      </Switch.Root>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </span>
    </label>
  );
}

export { Toggle };
