import { computed, signal } from "@preact/signals-react";
import type { Entry } from "../../shared/contract.ts";
import { api, describeError } from "../api/client.ts";

const ROOT_PATH = "";

type TreeRowModel = {
  entry: Entry;
  depth: number;
};

const childrenByPath = signal<Readonly<Record<string, readonly Entry[]>>>({});
const expandedPaths = signal<ReadonlySet<string>>(new Set([ROOT_PATH]));
const loadingPaths = signal<ReadonlySet<string>>(new Set<string>());
const selectedPath = signal<string | null>(null);
const treeError = signal<string | null>(null);

const visibleRows = computed<readonly TreeRowModel[]>(() => {
  const children = childrenByPath.value;
  const expanded = expandedPaths.value;
  const rows: TreeRowModel[] = [];
  const walk = (parent: string, depth: number): void => {
    const entries = children[parent];
    if (entries === undefined) {
      return;
    }
    for (const entry of entries) {
      rows.push({ entry, depth });
      if (entry.type === "dir" && expanded.has(entry.path)) {
        walk(entry.path, depth + 1);
      }
    }
  };
  walk(ROOT_PATH, 0);
  return rows;
});

function withPath(set: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(set);
  next.add(path);
  return next;
}

function withoutPath(set: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(path);
  return next;
}

function isDescendant(candidate: string, ancestor: string): boolean {
  return candidate.startsWith(`${ancestor}/`);
}

async function loadChildren(dirPath: string): Promise<void> {
  if (childrenByPath.value[dirPath] !== undefined || loadingPaths.value.has(dirPath)) {
    return;
  }
  loadingPaths.value = withPath(loadingPaths.value, dirPath);
  try {
    const { entries } = await api.fs.list.query({ path: dirPath });
    childrenByPath.value = { ...childrenByPath.value, [dirPath]: entries };
    treeError.value = null;
  } catch (error) {
    treeError.value = describeError(error);
  } finally {
    loadingPaths.value = withoutPath(loadingPaths.value, dirPath);
  }
}

function expandDirectory(dirPath: string): void {
  if (expandedPaths.value.has(dirPath)) {
    return;
  }
  expandedPaths.value = withPath(expandedPaths.value, dirPath);
  void loadChildren(dirPath);
}

/**
 * Collapsing drops the cached listing for the directory and everything under
 * it, so reopening a folder shows what is on disk now rather than what was
 * there the first time it was opened.
 */
function collapseDirectory(dirPath: string): void {
  const expanded = new Set<string>();
  for (const path of expandedPaths.value) {
    if (path !== dirPath && !isDescendant(path, dirPath)) {
      expanded.add(path);
    }
  }
  expandedPaths.value = expanded;

  const children: Record<string, readonly Entry[]> = {};
  for (const [path, entries] of Object.entries(childrenByPath.value)) {
    if (path !== dirPath && !isDescendant(path, dirPath)) {
      children[path] = entries;
    }
  }
  childrenByPath.value = children;
}

function toggleDirectory(dirPath: string): void {
  if (expandedPaths.value.has(dirPath)) {
    collapseDirectory(dirPath);
    return;
  }
  expandDirectory(dirPath);
}

function selectPath(path: string): void {
  selectedPath.value = path;
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? ROOT_PATH : path.slice(0, slash);
}

export {
  ROOT_PATH,
  collapseDirectory,
  expandDirectory,
  expandedPaths,
  loadChildren,
  loadingPaths,
  parentOf,
  selectPath,
  selectedPath,
  toggleDirectory,
  treeError,
  visibleRows,
};
export type { TreeRowModel };
