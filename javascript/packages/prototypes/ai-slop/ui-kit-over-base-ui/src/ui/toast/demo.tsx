import * as React from "react"
import { Toast } from "./Toast"

export const meta = { title: "Toast" }

function ToastList() {
  const { toasts } = Toast.useToastManager()
  return toasts.map((toast) => (
    <Toast.Root key={toast.id} toast={toast}>
      <Toast.Content>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Toast.Title />
          <Toast.Description />
        </div>
        <Toast.Close aria-label="Close" />
      </Toast.Content>
    </Toast.Root>
  ))
}

function CreateToastButton() {
  const toastManager = Toast.useToastManager()
  const [count, setCount] = React.useState(0)

  function createToast() {
    const next = count + 1
    setCount(next)
    toastManager.add({
      title: `Notification ${next}`,
      description: "Your changes have been saved successfully.",
    })
  }

  return (
    <button
      type="button"
      onClick={createToast}
      style={{
        height: 38,
        padding: "0 16px",
        border: "1px solid var(--uk-primary)",
        borderRadius: "var(--uk-radius)",
        background: "var(--uk-primary)",
        color: "var(--uk-primary-fg)",
        fontSize: "0.875rem",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Create toast
    </button>
  )
}

export default function ToastDemo() {
  return (
    <Toast.Provider>
      <CreateToastButton />
      <Toast.Portal>
        <Toast.Viewport>
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}
