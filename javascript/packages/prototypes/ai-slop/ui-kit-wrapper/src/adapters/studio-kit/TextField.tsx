import { StudioText } from "../../vendor/studio-kit";
import type { TextFieldProps } from "../../ui/contract";

/**
 * Compare with the Base UI adapter's `TextField`: four composed parts there, one
 * component here, because this kit already bundles label, hint, and error.
 *
 * `type` is the awkward bit. The contract has one union; the kit splits it into
 * `kind` plus a `secret` boolean. Small, ugly, and contained — the app keeps
 * writing `type="password"` under both kits.
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
    <StudioText
      caption={label}
      value={value}
      onInput={onValueChange}
      kind={type === "email" ? "email" : "text"}
      secret={type === "password"}
      ghostText={placeholder}
      note={hint}
      problem={error}
      off={disabled}
      mandatory={required}
    />
  );
}

export { TextField };
