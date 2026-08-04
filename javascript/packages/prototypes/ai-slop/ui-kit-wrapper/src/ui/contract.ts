import type { ComponentType, ReactNode } from "react";

/**
 * The contract between the app and whatever UI kit renders it.
 *
 * Rules that keep this file swappable:
 *
 * 1. No imports from any UI kit. Types only. If this file needed
 *    `@base-ui/react` types, every kit would have to be Base UI.
 * 2. Props describe the *job*, not a widget anatomy. `ConfirmDialog` instead of
 *    a 9-part `Dialog`. A kit can always express a narrow job; it cannot always
 *    express another kit's anatomy.
 * 3. Data in, callbacks out. `options={[...]}` instead of children, so a kit is
 *    free to render a popup listbox, a native `<select>`, or a sheet on mobile.
 * 4. Narrower than the kit. The Base UI kit has three button sizes; the contract
 *    exposes two. Every prop here is a promise the *next* kit has to keep.
 */

type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type ButtonProps = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
};

type TextFieldProps = {
  label: string;
  value: string;
  onValueChange: (next: string) => void;
  type?: "text" | "email" | "password";
  placeholder?: string;
  /** Helper text below the control. Hidden while `error` is set. */
  hint?: string;
  /** App-owned validation message. Presence of a string means invalid. */
  error?: string;
  disabled?: boolean;
  required?: boolean;
};

type SelectFieldProps = {
  label: string;
  value: string;
  onValueChange: (next: string) => void;
  options: SelectOption[];
  placeholder?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
};

type ToggleProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  hint?: string;
  disabled?: boolean;
};

type TabItem = {
  value: string;
  label: string;
  /**
   * A function, not a node. Some kits mount every panel and hide the inactive
   * ones; others mount only the active panel. A thunk means the app never pays
   * for panels a kit decides not to show.
   */
  render: () => ReactNode;
};

type TabsProps = {
  value: string;
  onValueChange: (next: string) => void;
  items: TabItem[];
};

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Extra body content between the description and the buttons. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  destructive?: boolean;
  onConfirm: () => void;
};

type ToastTone = "neutral" | "success" | "danger";

type ToastRequest = {
  title: string;
  description?: string;
  tone?: ToastTone;
};

type ToastApi = {
  show: (toast: ToastRequest) => void;
};

type UiKitRootProps = {
  children: ReactNode;
};

/**
 * One kit implementation. An adapter exports exactly one of these, and
 * `satisfies UiKit` turns any gap into a compile error instead of a blank
 * screen three sprints later.
 */
type UiKit = {
  /** Also used as `data-kit` on `<html>`, so each kit can scope its CSS. */
  id: string;
  label: string;
  /** Mounts whatever the kit needs once: toast host, portal root, providers. */
  Root: ComponentType<UiKitRootProps>;
  Button: ComponentType<ButtonProps>;
  TextField: ComponentType<TextFieldProps>;
  SelectField: ComponentType<SelectFieldProps>;
  Toggle: ComponentType<ToggleProps>;
  Tabs: ComponentType<TabsProps>;
  ConfirmDialog: ComponentType<ConfirmDialogProps>;
  useToast: () => ToastApi;
};

type ThemeMode = "light" | "dark";

type PaletteName = "default" | "sunset";

export type {
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
  ToastRequest,
  ToastTone,
  ToggleProps,
  UiKit,
  UiKitRootProps,
};
