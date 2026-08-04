import * as React from "react";
import { Toast } from "@hw/ui-kit-over-base-ui/src/ui/toast/Toast";
import type { ToastApi, ToastTone, UiKitRootProps } from "../../ui/contract";
import styles from "./adapter.module.css";

/**
 * Every kit needs something mounted once — a provider, a portal target, a toast
 * host. `Root` is where the contract puts it, so the app has one stable place to
 * wrap the tree and never learns what is inside.
 *
 * This kit's toasts are a provider plus a manager hook plus a viewport the app
 * has to render itself. The studio kit's are a module-level store and a single
 * host element. Both end up behind `useToast().show(...)`.
 */
const tones: Record<ToastTone, { type: string; priority: "low" | "high" }> = {
  neutral: { type: "neutral", priority: "low" },
  success: { type: "success", priority: "low" },
  danger: { type: "danger", priority: "high" },
};

function ToastList() {
  const { toasts } = Toast.useToastManager();

  return toasts.map((toast) => (
    <Toast.Root key={toast.id} toast={toast} className={styles.toast}>
      <Toast.Content>
        <div className={styles.toastText}>
          <Toast.Title />
          <Toast.Description />
        </div>
        <Toast.Close aria-label="Close" />
      </Toast.Content>
    </Toast.Root>
  ));
}

function Root({ children }: UiKitRootProps) {
  return (
    <Toast.Provider>
      {children}
      <Toast.Portal>
        <Toast.Viewport>
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function useToast(): ToastApi {
  const manager = Toast.useToastManager();

  return React.useMemo<ToastApi>(
    () => ({
      show: ({ title, description, tone = "neutral" }) => {
        manager.add({
          title,
          description,
          type: tones[tone].type,
          priority: tones[tone].priority,
        });
      },
    }),
    [manager],
  );
}

export { Root, useToast };
