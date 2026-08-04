import { Switch } from "@hw/faenwald-uikit";
import { useSignals } from "@preact/signals-react/runtime";
import { theme, toggleTheme } from "./theme-state";
import styles from "./theme-switch.module.css";

function ThemeSwitch() {
  useSignals();

  const dark = theme.value === "dark";

  return (
    <label className={styles.wrap}>
      <span className={styles.icon}>{dark ? "☾" : "☀"}</span>
      <Switch.Root checked={dark} onCheckedChange={toggleTheme}>
        <Switch.Thumb />
      </Switch.Root>
      <span className={styles.label}>{dark ? "Dark" : "Light"}</span>
    </label>
  );
}

export { ThemeSwitch };
