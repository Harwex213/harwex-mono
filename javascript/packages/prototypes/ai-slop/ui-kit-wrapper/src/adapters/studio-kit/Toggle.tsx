import { StudioToggle } from "../../vendor/studio-kit";
import type { ToggleProps } from "../../ui/contract";

/**
 * The contract says `Toggle`, not `Switch`, because this kit's answer is a
 * checkbox and the other kit's is a sliding switch.
 *
 * Naming a contract component after a widget you have seen is how a contract
 * quietly becomes a description of one kit.
 */
function Toggle({ label, checked, onCheckedChange, hint, disabled = false }: ToggleProps) {
  return (
    <StudioToggle
      caption={label}
      on={checked}
      onFlip={onCheckedChange}
      note={hint}
      off={disabled}
    />
  );
}

export { Toggle };
