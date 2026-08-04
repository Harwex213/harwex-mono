import { StudioButton, StudioModal } from "../../vendor/studio-kit";
import type { ConfirmDialogProps } from "../../ui/contract";

/**
 * The kit takes buttons as a `footer` prop and renders a native `<dialog>`, so
 * the backdrop, focus trap, and Escape key come from the browser.
 *
 * The Base UI adapter builds the same thing out of Portal, Backdrop, Viewport,
 * and Popup. Nothing about those two trees is interchangeable, which is the
 * reason the contract stops at `open`, `title`, and `onConfirm`.
 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  function confirm() {
    onConfirm();
    onOpenChange(false);
  }

  return (
    <StudioModal
      open={open}
      heading={title}
      onDismiss={() => onOpenChange(false)}
      footer={
        <>
          <StudioButton kind="quiet" onPress={() => onOpenChange(false)}>
            {cancelLabel}
          </StudioButton>
          <StudioButton kind={destructive ? "critical" : "accent"} onPress={confirm}>
            {confirmLabel}
          </StudioButton>
        </>
      }
    >
      {description ? <p>{description}</p> : null}
      {children}
    </StudioModal>
  );
}

export { ConfirmDialog };
