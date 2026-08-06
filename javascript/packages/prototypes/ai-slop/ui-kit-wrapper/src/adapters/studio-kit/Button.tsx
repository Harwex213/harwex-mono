import { StudioButton } from "../../vendor/studio-kit";
import type { ButtonProps } from "../../ui/contract";

/**
 * Pure translation. Every prop has a different name, and the intent maps
 * one-to-one, so the adapter is two lookup tables.
 *
 * Keeping these tables in the adapter is the point. Spread across the app they
 * would be forty scattered ternaries, and the swap would be a forty-file diff
 * instead of this file.
 */
const kinds = {
  primary: "accent",
  secondary: "outline",
  ghost: "quiet",
  danger: "critical",
} as const;

const scales = {
  sm: "compact",
  md: "regular",
} as const;

function Button({
  children,
  variant = "primary",
  size = "md",
  type = "button",
  disabled = false,
  loading = false,
  onClick,
}: ButtonProps) {
  return (
    <StudioButton
      kind={kinds[variant]}
      scale={scales[size]}
      submit={type === "submit"}
      off={disabled}
      busy={loading}
      onPress={onClick}
    >
      {children}
    </StudioButton>
  );
}

export { Button };
