import { computed } from "@preact/signals-react";
import {
  DEFAULT_EXCALIDRAW_STYLE,
  EXCALIDRAW_DEFAULT_STYLE_SETTING,
  pickExcalidrawStyle,
} from "@hw/harwex-notes-protocol";
import type { TExcalidrawStyle, TFsNode } from "@hw/harwex-notes-protocol";
import type { TFsSlice } from "./fs-slice";
import type { TSessionSlice } from "./session-slice";

// The vault-relative path of every file, as a drawing link names it (EX-9). Folders are
// left out: a link opens a file.
const readFilePaths = (nodes: readonly TFsNode[]): readonly string[] => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const pathById = new Map<string, string>();

  const readPath = (node: TFsNode): string => {
    const known = pathById.get(node.id);
    if (known !== undefined) {
      return known;
    }

    const parent = node.parentId === null ? undefined : nodeById.get(node.parentId);
    const nodePath = parent === undefined ? node.name : `${readPath(parent)}/${node.name}`;

    pathById.set(node.id, nodePath);

    return nodePath;
  };

  return nodes
    .filter((node) => node.kind !== "folder")
    .map(readPath)
    .sort((left, right) => left.localeCompare(right));
};

const createExcalidrawDerivedState = (fs: TFsSlice, session: TSessionSlice) => {
  // The style a drawing without its own style uses: the user's choice (SET-2) over the
  // app's own default.
  const excalidrawDefaultStyle = computed((): Required<TExcalidrawStyle> => {
    const chosen = pickExcalidrawStyle(session.settings.value[EXCALIDRAW_DEFAULT_STYLE_SETTING]);

    return { ...DEFAULT_EXCALIDRAW_STYLE, ...chosen };
  });

  const vaultFilePaths = computed(() => readFilePaths(fs.nodes.value));

  return {
    excalidrawDefaultStyle,
    vaultFilePaths,
  };
};

export { createExcalidrawDerivedState };
