import type { TFsNode, TFsNodeKind } from "@hw/harwex-notes-protocol";
import type { TFsDraft } from "./fs-viewer.types";

type TFsNodeRow = {
  type: "node";
  node: TFsNode;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
};

type TFsDraftRow = {
  type: "draft";
  depth: number;
  kind: TFsNodeKind;
};

type TFsRow = TFsNodeRow | TFsDraftRow;

const groupChildIds = (nodes: Iterable<TFsNode>) => {
  const childIdsByParentId = new Map<string, string[]>();
  const rootIds: string[] = [];

  for (const node of nodes) {
    if (node.parentId === null) {
      rootIds.push(node.id);

      continue;
    }

    const siblings = childIdsByParentId.get(node.parentId);
    if (siblings === undefined) {
      childIdsByParentId.set(node.parentId, [node.id]);

      continue;
    }

    siblings.push(node.id);
  }

  return { childIdsByParentId, rootIds };
};

// Folders come before files, and each group is sorted by name, so a fresh node lands
// where the reader expects it instead of at the end of the list.
const sortIds = (ids: readonly string[], nodeById: ReadonlyMap<string, TFsNode>) => {
  return [...ids].sort((leftId, rightId) => {
    const left = nodeById.get(leftId);
    const right = nodeById.get(rightId);
    if (left === undefined || right === undefined) {
      return 0;
    }

    if (left.kind !== right.kind) {
      if (left.kind === "folder") {
        return -1;
      }

      if (right.kind === "folder") {
        return 1;
      }
    }

    return left.name.localeCompare(right.name);
  });
};

// A search lists every match under its real folders. A folder that matches by name keeps
// its whole content, so expanding it shows every entry inside and not an empty folder.
const collectSearchVisibleIds = (
  nodeById: ReadonlyMap<string, TFsNode>,
  matchIds: Iterable<string>
): ReadonlySet<string> => {
  const { childIdsByParentId } = groupChildIds(nodeById.values());
  const visibleIds = new Set<string>();
  const pendingIds: string[] = [];

  for (const matchId of matchIds) {
    const match = nodeById.get(matchId);
    if (match === undefined) {
      continue;
    }

    if (match.kind === "folder") {
      pendingIds.push(match.id);
    }

    let current: TFsNode | undefined = match;
    while (current !== undefined && !visibleIds.has(current.id)) {
      visibleIds.add(current.id);
      current = current.parentId === null ? undefined : nodeById.get(current.parentId);
    }
  }

  while (pendingIds.length > 0) {
    const folderId = pendingIds.pop() as string;

    for (const childId of childIdsByParentId.get(folderId) ?? []) {
      visibleIds.add(childId);
      pendingIds.push(childId);
    }
  }

  return visibleIds;
};

// visibleIds is null outside a search, and every node is listed then.
const flattenTree = (
  nodeById: ReadonlyMap<string, TFsNode>,
  expandedIds: readonly string[],
  draft: TFsDraft | null,
  visibleIds: ReadonlySet<string> | null = null
): readonly TFsRow[] => {
  const { childIdsByParentId, rootIds } = groupChildIds(nodeById.values());
  const expanded = new Set(expandedIds);
  const rows: TFsRow[] = [];

  // The draft row sits after the last child of its parent.
  const pushDraftRow = (parentId: string | null, depth: number) => {
    if (draft === null || draft.mode !== "create" || draft.parentId !== parentId) {
      return;
    }

    rows.push({ type: "draft", depth, kind: draft.kind });
  };

  const walk = (ids: readonly string[], depth: number, parentId: string | null) => {
    for (const id of sortIds(ids, nodeById)) {
      const node = nodeById.get(id);
      if (node === undefined || (visibleIds !== null && !visibleIds.has(id))) {
        continue;
      }

      const childIds = childIdsByParentId.get(id) ?? [];
      const isExpanded = expanded.has(id);

      rows.push({
        type: "node",
        node,
        depth,
        hasChildren: childIds.length > 0,
        isExpanded,
      });

      if (node.kind === "folder" && isExpanded) {
        walk(childIds, depth + 1, id);
      }
    }

    pushDraftRow(parentId, depth);
  };

  walk(rootIds, 0, null);

  return rows;
};

export type { TFsDraftRow, TFsNodeRow, TFsRow };
export { collectSearchVisibleIds, flattenTree };
