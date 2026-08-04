import { Button as UkButton } from "@hw/ui-kit-over-base-ui/src/ui/button/Button";
import { Dialog } from "@hw/ui-kit-over-base-ui/src/ui/dialog/Dialog";
import type { ConfirmDialogProps } from "../../ui/contract";
import styles from "./adapter.module.css";

/**
 * The contract names the job — confirm something — instead of exposing a
 * general-purpose dialog.
 *
 * A general `Dialog` would have to expose an `actions` slot, and then the app
 * decides button order, button variants, and which button closes the dialog.
 * Those decisions leak the kit's layout into the app and differ per kit. A
 * `ConfirmDialog` owns all three, so both adapters put the destructive button on
 * the right without the app saying so.
 *
 * Note that the adapter uses the *kit's* button, not the facade's. Adapters
 * depend on `contract.ts` and on their kit. Never on the facade — that is a
 * cycle, and it would let one adapter accidentally render another kit.
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
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup>
            <Dialog.Title>{title}</Dialog.Title>
            {description ? <Dialog.Description>{description}</Dialog.Description> : null}
            {children ? <div className={styles.dialogBody}>{children}</div> : null}
            <div className={styles.dialogActions}>
              <UkButton.Root variant="secondary" onClick={() => onOpenChange(false)}>
                {cancelLabel}
              </UkButton.Root>
              <UkButton.Root
                variant={destructive ? "danger" : "primary"}
                onClick={confirm}
              >
                {confirmLabel}
              </UkButton.Root>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export { ConfirmDialog };
