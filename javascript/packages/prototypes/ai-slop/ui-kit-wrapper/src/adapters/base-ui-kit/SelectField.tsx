import { Select } from "@hw/ui-kit-over-base-ui/src/ui/select/Select";
import type { SelectFieldProps } from "../../ui/contract";
import styles from "./adapter.module.css";

/**
 * The component that justifies the whole pattern.
 *
 * This kit's Select has eighteen parts. Re-exporting all eighteen would look
 * like progress and would in fact hand the app a permanent dependency on Base
 * UI's popup anatomy: every screen would spell out Portal, Positioner, Popup,
 * List, ItemIndicator. No other kit has that tree, so the swap would mean
 * rewriting every screen.
 *
 * The contract takes `options` and gives back a value. Eighteen parts collapse
 * into one prop, and the studio adapter renders the same contract with a native
 * `<select>` — sixty lines shorter and still correct.
 */
function SelectField({
  label,
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  hint,
  error,
  disabled = false,
}: SelectFieldProps) {
  const items = options.map((option) => ({
    value: option.value,
    label: option.label,
  }));

  return (
    <div className={styles.selectField}>
      <Select.Root
        items={items}
        value={value}
        disabled={disabled}
        onValueChange={(next) => onValueChange(String(next ?? ""))}
      >
        <Select.Label>{label}</Select.Label>
        <Select.Trigger>
          <Select.Value placeholder={placeholder} />
          <Select.Icon />
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner>
            <Select.Popup>
              <Select.ScrollUpArrow />
              <Select.List>
                {options.map((option) => (
                  <Select.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    <Select.ItemIndicator />
                    <Select.ItemText>{option.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.List>
              <Select.ScrollDownArrow />
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
      {hint && !error ? <p className={styles.hint}>{hint}</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { SelectField };
