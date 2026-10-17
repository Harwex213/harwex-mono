import type { TFsNode, TJsonValue, TTreeState } from "@hw/harwex-notes-protocol";
import type { TContext } from "../trpc.js";

// The state key of a node: its vault-relative path with "/" separators, whatever the OS.
const readNodePath = (nodes: readonly TFsNode[], nodeId: string): string => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const segments: string[] = [];
  let currentId: string | null = nodeId;

  while (currentId !== null) {
    const node = byId.get(currentId);
    if (node === undefined) {
      throw new Error(`No node was found for "${currentId}"`);
    }

    segments.unshift(node.name);
    currentId = node.parentId;
  }

  return segments.join("/");
};

// UI state is secondary to the content. The file operation has already succeeded on disk
// when this runs, so a state failure is logged and never turns the operation into an error.
const runStateFollowUp = (task: () => void) => {
  try {
    task();
  } catch (error) {
    console.error(`Cannot update the UI state: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const followPathChange = (ctx: TContext, fromPath: string, toPath: string) => {
  runStateFollowUp(() => {
    ctx.stateStore.movePath(fromPath, toPath);
  });
};

const followPathRemoval = (ctx: TContext, nodePath: string) => {
  runStateFollowUp(() => {
    ctx.stateStore.removePath(nodePath);
  });
};

const fetchTreeState = (ctx: TContext): TTreeState | null => ctx.stateStore.readTreeState();

const saveTreeState = (ctx: TContext, state: TTreeState): void => {
  ctx.stateStore.writeTreeState(state);
};

const fetchNodeState = (ctx: TContext, nodePath: string, key: string): TJsonValue | null => {
  return ctx.stateStore.readNodeState(nodePath, key);
};

const saveNodeState = (ctx: TContext, nodePath: string, key: string, value: TJsonValue | null): void => {
  ctx.stateStore.writeNodeState(nodePath, key, value);
};

const fetchSetting = (ctx: TContext, key: string): TJsonValue | null => ctx.stateStore.readSetting(key);

const fetchSettings = (ctx: TContext): Readonly<Record<string, TJsonValue>> => ctx.stateStore.readSettings();

const saveSetting = (ctx: TContext, key: string, value: TJsonValue | null): void => {
  ctx.stateStore.writeSetting(key, value);
};

export {
  readNodePath,
  followPathChange,
  followPathRemoval,
  fetchTreeState,
  saveTreeState,
  fetchNodeState,
  saveNodeState,
  fetchSetting,
  fetchSettings,
  saveSetting,
};
