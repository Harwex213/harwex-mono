import "@hw/ui-kit-over-base-ui/src/theme.css";
import "./theme.css";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Root, useToast } from "./Root";
import { SelectField } from "./SelectField";
import { Tabs } from "./Tabs";
import { TextField } from "./TextField";
import { Toggle } from "./Toggle";
import type { UiKit } from "../../ui/contract";

/**
 * Adapter for the shared kit at `@hw/ui-kit-over-base-ui`.
 *
 * The kit's own token file loads first for the values this adapter does not
 * bridge (spacing, motion); `./theme.css` then maps `--app-*` over the rest.
 *
 * `satisfies UiKit` is the load-bearing line. Add a component to the contract
 * and this file fails to compile until the adapter implements it. Without it,
 * "we support both kits" is a claim nobody checks until a page renders blank.
 */
const kit = {
  id: "base-ui",
  label: "Shared kit · Base UI",
  Root,
  Button,
  TextField,
  SelectField,
  Toggle,
  Tabs,
  ConfirmDialog,
  useToast,
} satisfies UiKit;

export { kit };
