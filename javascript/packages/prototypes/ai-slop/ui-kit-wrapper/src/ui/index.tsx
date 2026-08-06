import * as React from "react";
import { kit as buildTimeKit } from "@kit";
import { Card } from "./Card";
import "./tokens.css";
import type {
  ButtonProps,
  ConfirmDialogProps,
  PaletteName,
  SelectFieldProps,
  SelectOption,
  TabItem,
  TabsProps,
  TextFieldProps,
  ThemeMode,
  ToastApi,
  ToggleProps,
  UiKit,
} from "./contract";

/**
 * The facade. App code imports from here and nowhere else.
 *
 * Each export below is a forwarder: it looks up the component on the active kit
 * and renders it. Two consequences worth the indirection:
 *
 * - The default kit comes from the "@kit" alias, resolved at build time. Ship
 *   one adapter, bundle one kit.
 * - `UiProvider` can override it at runtime. That is how you run both kits side
 *   by side during a migration, or A/B a new design system on 5% of traffic.
 *
 * Props and types come from `contract.ts`, never from a kit. `Button`'s
 * signature does not change when the kit under it changes.
 */

const KitContext = React.createContext<UiKit>(buildTimeKit);

function useKit(): UiKit {
  return React.useContext(KitContext);
}

type UiProviderProps = {
  kit?: UiKit;
  mode?: ThemeMode;
  palette?: PaletteName;
  children: React.ReactNode;
};

function UiProvider({
  kit = buildTimeKit,
  mode = "light",
  palette = "default",
  children,
}: UiProviderProps) {
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.kit = kit.id;
    root.dataset.mode = mode;
    root.dataset.palette = palette;
  }, [kit.id, mode, palette]);

  const Root = kit.Root;

  return (
    <KitContext.Provider value={kit}>
      {/*
        `useToast` resolves to a different hook per kit, and swapping hook
        implementations mid-render is a hook-order violation. Keying on the kit
        id remounts the subtree on a swap, so the old hooks unmount first. Cost:
        app state resets when you switch kits. That is the honest price of a
        runtime swap, and the reason production pins one kit at build time.
      */}
      <React.Fragment key={kit.id}>
        <Root>{children}</Root>
      </React.Fragment>
    </KitContext.Provider>
  );
}

function Button(props: ButtonProps) {
  const Impl = useKit().Button;
  return <Impl {...props} />;
}

function TextField(props: TextFieldProps) {
  const Impl = useKit().TextField;
  return <Impl {...props} />;
}

function SelectField(props: SelectFieldProps) {
  const Impl = useKit().SelectField;
  return <Impl {...props} />;
}

function Toggle(props: ToggleProps) {
  const Impl = useKit().Toggle;
  return <Impl {...props} />;
}

function Tabs(props: TabsProps) {
  const Impl = useKit().Tabs;
  return <Impl {...props} />;
}

function ConfirmDialog(props: ConfirmDialogProps) {
  const Impl = useKit().ConfirmDialog;
  return <Impl {...props} />;
}

function useToast(): ToastApi {
  return useKit().useToast();
}

/**
 * The kit the "@kit" alias resolved to. App code has no reason to touch this;
 * migration tooling and the demo harness do, to show which kit is wired in.
 */
const defaultKit = buildTimeKit;

export {
  Button,
  Card,
  ConfirmDialog,
  SelectField,
  Tabs,
  TextField,
  Toggle,
  UiProvider,
  defaultKit,
  useToast,
};
export type { PaletteName, SelectOption, TabItem, ThemeMode, UiKit };
