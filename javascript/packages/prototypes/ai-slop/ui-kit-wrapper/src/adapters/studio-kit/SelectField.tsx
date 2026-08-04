import { StudioPicker } from "../../vendor/studio-kit";
import type { SelectFieldProps } from "../../ui/contract";

/**
 * The payoff for the data-driven contract.
 *
 * The Base UI adapter needs a sixty-line compound tree for this. Here the same
 * contract is a native `<select>` behind a rename: `options` becomes `choices`,
 * `{ value, label }` becomes `{ id, text }`.
 *
 * Had the contract exposed the Base UI anatomy instead, this adapter would be
 * impossible — there is no Positioner or ItemIndicator to hand a `<select>`.
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
  const choices = options.map((option) => ({
    id: option.value,
    text: option.label,
    off: option.disabled,
  }));

  return (
    <StudioPicker
      caption={label}
      current={value}
      choices={choices}
      onPick={onValueChange}
      emptyText={placeholder}
      note={hint}
      problem={error}
      off={disabled}
    />
  );
}

export { SelectField };
