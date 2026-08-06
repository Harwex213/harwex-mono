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
 * Adapter for the project-specific studio kit.
 *
 * Same exports, same shape, same `satisfies UiKit` check as the Base UI adapter.
 * That symmetry is the deliverable: `vite.config.ts` points "@kit" at either
 * directory and nothing else in the app changes.
 */
const kit = {
  id: "studio",
  label: "Project kit · Studio",
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
