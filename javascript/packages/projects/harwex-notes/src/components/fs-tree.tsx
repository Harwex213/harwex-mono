import { useSignals } from "@preact/signals-react/runtime";
import { useRef } from "react";
import type { Entry } from "../../shared/contract.ts";
import { openPaths, openTab } from "../state/tabs-store.ts";
import {
  collapseDirectory,
  expandDirectory,
  expandedPaths,
  loadingPaths,
  parentOf,
  selectPath,
  selectedPath,
  toggleDirectory,
  treeError,
  visibleRows,
} from "../state/tree-store.ts";
import { TreeRow } from "./tree-row.tsx";

function FsTree() {
  useSignals();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rows = visibleRows.value;
  const expanded = expandedPaths.value;
  const loading = loadingPaths.value;
  const selected = selectedPath.value;
  const openSet = new Set(openPaths.value);

  const focusIndex = (index: number): void => {
    const row = rows[index];
    if (row === undefined) {
      return;
    }
    selectPath(row.entry.path);
    const node = containerRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    node?.focus();
  };

  const activate = (entry: Entry): void => {
    if (entry.type === "dir") {
      toggleDirectory(entry.path);
      return;
    }
    openTab(entry.path);
  };

  const currentIndex = rows.findIndex((row) => {
    return row.entry.path === selected;
  });

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (rows.length === 0) {
      return;
    }
    const index = currentIndex === -1 ? 0 : currentIndex;
    const row = rows[index];
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusIndex(Math.min(index + 1, rows.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusIndex(Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusIndex(rows.length - 1);
      return;
    }
    if (row === undefined) {
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (row.entry.type === "dir" && !expanded.has(row.entry.path)) {
        expandDirectory(row.entry.path);
        return;
      }
      focusIndex(Math.min(index + 1, rows.length - 1));
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.entry.type === "dir" && expanded.has(row.entry.path)) {
        collapseDirectory(row.entry.path);
        return;
      }
      // Collapsed, or a file: jump to the parent row, JetBrains-style.
      const parent = parentOf(row.entry.path);
      const parentIndex = rows.findIndex((candidate) => {
        return candidate.entry.path === parent;
      });
      if (parentIndex !== -1) {
        focusIndex(parentIndex);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(row.entry);
    }
  };

  return (
    <div className="tree-panel">
      {treeError.value !== null ? <div className="tree-error">{treeError.value}</div> : null}
      <div
        className="tree"
        role="tree"
        aria-label="Notes root"
        ref={containerRef}
        onKeyDown={handleKeyDown}
      >
        {rows.length === 0 ? <div className="tree-empty">nothing here yet</div> : null}
        {rows.map((row, index) => {
          return (
            <TreeRow
              key={row.entry.path}
              entry={row.entry}
              depth={row.depth}
              index={index}
              isSelected={row.entry.path === selected}
              isExpanded={expanded.has(row.entry.path)}
              isLoading={loading.has(row.entry.path)}
              isOpen={openSet.has(row.entry.path)}
              onSelect={selectPath}
              onActivate={activate}
            />
          );
        })}
      </div>
    </div>
  );
}

export { FsTree };
