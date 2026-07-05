import { Dialog } from "./Dialog"
import styles from "./dialog.module.css"

export const meta = { title: "Dialog" }

export default function DialogDemo() {
  return (
    <Dialog.Root>
      <Dialog.Trigger>Edit profile</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup>
            <Dialog.Close className={styles.iconClose} aria-label="Close">
              <svg viewBox="0 0 14 14" width="14" height="14" fill="none">
                <path
                  d="M3 3 11 11M11 3 3 11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </Dialog.Close>
            <Dialog.Title>Edit profile</Dialog.Title>
            <Dialog.Description>
              Make changes to your account here. Click save when you are done.
            </Dialog.Description>
            <div className={styles.actions}>
              <Dialog.Close>Cancel</Dialog.Close>
              <Dialog.Close className={styles.confirm}>Save changes</Dialog.Close>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
