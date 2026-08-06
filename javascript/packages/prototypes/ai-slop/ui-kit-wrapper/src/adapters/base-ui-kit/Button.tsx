import { Button as UkButton } from "@hw/ui-kit-over-base-ui/src/ui/button/Button";
import type { ButtonProps } from "../../ui/contract";
import styles from "./adapter.module.css";

/**
 * The easy case: the kit already has `variant` and `size` with matching values,
 * so the adapter is a rename and a default.
 *
 * `loading` is the interesting part. The kit has no loading state, so the
 * adapter synthesises one — disable the button and prepend a spinner. That is
 * the adapter's job: keep the contract's promise even when the kit cannot.
 */
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
    <UkButton.Root
      type={type}
      variant={variant}
      size={size}
      disabled={disabled || loading}
      onClick={onClick}
      className={loading ? styles.loading : undefined}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {children}
    </UkButton.Root>
  );
}

export { Button };
