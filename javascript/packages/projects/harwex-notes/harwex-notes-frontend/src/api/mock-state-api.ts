// In-memory mirror of the backend `state` router for `yarn dev:mocked`. It follows the
// same rules: rows are keyed by vault path, a rename or move carries the rows of the node
// and everything below it, a delete drops them. Nothing survives a reload.
import type { TApiClient } from "./api";
import type { TFsNode, TJsonValue, TTreeState } from "./types";

const STATE_LATENCY_MS = 60;

const delay = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

const isInRange = (candidate: string, rangePath: string) => {
  return candidate === rangePath || candidate.startsWith(`${rangePath}/`);
};

const movePathInRange = (candidate: string, fromPath: string, toPath: string) => {
  return isInRange(candidate, fromPath) ? `${toPath}${candidate.slice(fromPath.length)}` : candidate;
};

const nodeStateKey = (nodePath: string, key: string) => JSON.stringify([nodePath, key]);

const readNodeStatePath = (rowKey: string): string => (JSON.parse(rowKey) as [string, string])[0];

const readNodeStateKey = (rowKey: string): string => (JSON.parse(rowKey) as [string, string])[1];

const readMockNodePath = (nodes: readonly TFsNode[], nodeId: string): string => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const segments: string[] = [];
  let currentId: string | null = nodeId;

  while (currentId !== null) {
    const node = nodeById.get(currentId);
    if (node === undefined) {
      throw new Error(`No node was found for "${currentId}"`);
    }

    segments.unshift(node.name);
    currentId = node.parentId;
  }

  return segments.join("/");
};

const createMockStateApi = () => {
  let tree: TTreeState | null = null;
  let nodeState = new Map<string, TJsonValue>();
  const settings = new Map<string, TJsonValue>();

  const followPathChange = (fromPath: string, toPath: string) => {
    if (fromPath === toPath) {
      return;
    }

    if (tree !== null) {
      const selectedPath = tree.selectedPath;

      tree = {
        expandedPaths: tree.expandedPaths.map((nodePath) => movePathInRange(nodePath, fromPath, toPath)),
        selectedPath: selectedPath === null ? null : movePathInRange(selectedPath, fromPath, toPath),
      };
    }

    nodeState = new Map([...nodeState].map(([rowKey, value]) => {
      const nodePath = movePathInRange(readNodeStatePath(rowKey), fromPath, toPath);

      return [nodeStateKey(nodePath, readNodeStateKey(rowKey)), value];
    }));
  };

  const followPathRemoval = (removedPath: string) => {
    if (tree !== null) {
      const selectedPath = tree.selectedPath;

      tree = {
        expandedPaths: tree.expandedPaths.filter((nodePath) => !isInRange(nodePath, removedPath)),
        selectedPath: selectedPath !== null && isInRange(selectedPath, removedPath) ? null : selectedPath,
      };
    }

    nodeState = new Map([...nodeState].filter(([rowKey]) => !isInRange(readNodeStatePath(rowKey), removedPath)));
  };

  const fetchTree = async () => {
    await delay(STATE_LATENCY_MS);

    return tree === null ? null : { expandedPaths: [...tree.expandedPaths], selectedPath: tree.selectedPath };
  };

  const saveTree = async (input: TTreeState): Promise<null> => {
    await delay(STATE_LATENCY_MS);

    tree = { expandedPaths: [...new Set(input.expandedPaths)].sort(), selectedPath: input.selectedPath };

    return null;
  };

  const fetchNodeState = async ({ path, key }: { path: string; key: string }) => {
    await delay(STATE_LATENCY_MS);

    return nodeState.get(nodeStateKey(path, key)) ?? null;
  };

  const saveNodeState = async ({
    path,
    key,
    value,
  }: {
    path: string;
    key: string;
    value: TJsonValue | null;
  }): Promise<null> => {
    await delay(STATE_LATENCY_MS);

    if (value === null) {
      nodeState.delete(nodeStateKey(path, key));
    } else {
      nodeState.set(nodeStateKey(path, key), value);
    }

    return null;
  };

  const fetchSettings = async () => {
    await delay(STATE_LATENCY_MS);

    return Object.fromEntries(settings);
  };

  const fetchSetting = async ({ key }: { key: string }) => {
    await delay(STATE_LATENCY_MS);

    return settings.get(key) ?? null;
  };

  const saveSetting = async ({ key, value }: { key: string; value: TJsonValue | null }): Promise<null> => {
    await delay(STATE_LATENCY_MS);

    if (value === null) {
      settings.delete(key);
    } else {
      settings.set(key, value);
    }

    return null;
  };

  const api: TApiClient["state"] = {
    tree: { query: fetchTree },
    setTree: { mutate: saveTree },
    getNodeState: { query: fetchNodeState },
    setNodeState: { mutate: saveNodeState },
    settings: { query: fetchSettings },
    getSetting: { query: fetchSetting },
    setSetting: { mutate: saveSetting },
  };

  // The mock fs reads settings directly, as the backend service does (SET-2).
  const readSetting = (key: string): TJsonValue | null => settings.get(key) ?? null;

  return { api, followPathChange, followPathRemoval, readSetting };
};

export { createMockStateApi, readMockNodePath };
