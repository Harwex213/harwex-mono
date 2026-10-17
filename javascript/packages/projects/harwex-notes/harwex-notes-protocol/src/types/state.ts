import { z } from "zod";

// UI state that survives a reload (SESS). It is keyed by the vault-relative path with "/"
// separators, never by node id: node ids are fresh on every backend start.
const statePathSchema = z.string().min(1);

const stateKeySchema = z.string().min(1);

const jsonValueSchema = z.json();

const treeStateSchema = z.object({
  expandedPaths: z.array(statePathSchema).readonly(),
  selectedPath: statePathSchema.nullable(),
});

const nodeStateInputSchema = z.object({
  path: statePathSchema,
  key: stateKeySchema,
});

// A `null` value removes the row.
const setNodeStateInputSchema = z.object({
  path: statePathSchema,
  key: stateKeySchema,
  value: jsonValueSchema.nullable(),
});

const settingInputSchema = z.object({
  key: stateKeySchema,
});

// A `null` value removes the row.
const setSettingInputSchema = z.object({
  key: stateKeySchema,
  value: jsonValueSchema.nullable(),
});

type TJsonValue = z.infer<typeof jsonValueSchema>;
type TTreeState = z.infer<typeof treeStateSchema>;
type TNodeStateInput = z.infer<typeof nodeStateInputSchema>;
type TSetNodeStateInput = z.infer<typeof setNodeStateInputSchema>;
type TSettingInput = z.infer<typeof settingInputSchema>;
type TSetSettingInput = z.infer<typeof setSettingInputSchema>;

export {
  statePathSchema,
  stateKeySchema,
  jsonValueSchema,
  treeStateSchema,
  nodeStateInputSchema,
  setNodeStateInputSchema,
  settingInputSchema,
  setSettingInputSchema,
};
export type {
  TJsonValue,
  TTreeState,
  TNodeStateInput,
  TSetNodeStateInput,
  TSettingInput,
  TSetSettingInput,
};
