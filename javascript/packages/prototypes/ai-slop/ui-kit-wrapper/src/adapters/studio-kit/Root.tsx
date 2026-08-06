import * as React from "react";
import { StudioToastRail, studioToast } from "../../vendor/studio-kit";
import type { ToastApi, ToastTone, UiKitRootProps } from "../../ui/contract";
import type { StudioToastLevel } from "../../vendor/studio-kit";

/**
 * No provider to mount, just the host element that reads the kit's module-level
 * store.
 *
 * `useToast` is a hook only because the contract says so. Nothing here needs
 * React state — the kit could be called from a fetch interceptor. Declaring the
 * contract as a hook is what keeps the Base UI adapter, which genuinely needs
 * one, possible. A contract has to fit the strictest implementation you intend
 * to support.
 */
const levels: Record<ToastTone, StudioToastLevel> = {
  neutral: "info",
  success: "good",
  danger: "bad",
};

function Root({ children }: UiKitRootProps) {
  return (
    <>
      {children}
      <StudioToastRail />
    </>
  );
}

function useToast(): ToastApi {
  return React.useMemo<ToastApi>(
    () => ({
      show: ({ title, description, tone = "neutral" }) => {
        studioToast.push({ level: levels[tone], text: title, detail: description });
      },
    }),
    [],
  );
}

export { Root, useToast };
