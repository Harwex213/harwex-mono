import "./fs-viewer.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FC, KeyboardEvent, MouseEvent } from "react";
import type { TFsNode, TFsNodeKind } from "@hw/harwex-notes-protocol";
import { FILE_EXTENSIONS, readFileKind } from "./fs-file-kinds";
import {
  Chevron,
  DraftIcon,
  NewFolderIcon,
  NewNoteIcon,
  NewSketchIcon,
  NodeIcon,
} from "./fs-icons";
import { flattenTree } from "./fs-rows";
import type { TFsViewerProps } from "./fs-viewer.types";

type TMenuState = {
  // A right click on the empty space below the tree aims at the vault root, and the root
  // is not a node, so the menu keeps no node for it.
  nodeId: string | null;
  x: number;
  y: number;
  isConfirmingDelete: boolean;
};

const INDENT_STEP_PX = 14;
const ROW_BASE_PADDING_PX = 8;
const MENU_WIDTH_PX = 176;
const MENU_MARGIN_PX = 8;

const NEW_NAME_BY_KIND: Readonly<Record<TFsNodeKind, string>> = {
  folder: "new-folder",
  file: "untitled",
  markdown: "untitled.md",
  excalidraw: "untitled.excalidraw",
};

const CREATE_ITEMS: readonly { kind: TFsNodeKind; label: string }[] = [
  { kind: "file", label: "New file" },
  { kind: "excalidraw", label: "New excalidraw" },
  { kind: "folder", label: "New folder" },
];

const EXTENSIONS_HINT = FILE_EXTENSIONS.join(" · ");

const LABEL_BY_KIND: Readonly<Record<TFsNodeKind, string>> = {
  folder: "folder",
  markdown: "note",
  excalidraw: "sketch",
  file: "file",
};

const readIndentStyle = (depth: number) => ({
  paddingLeft: `${ROW_BASE_PADDING_PX + depth * INDENT_STEP_PX}px`,
});

// Walks up from the candidate. A folder cannot swallow itself or one of its own parents,
// so a drop on such a target is refused before it reaches the host.
const isInsideSubtree = (
  nodeById: ReadonlyMap<string, TFsNode>,
  candidateId: string,
  rootId: string
) => {
  let currentId: string | null = candidateId;

  while (currentId !== null) {
    if (currentId === rootId) {
      return true;
    }

    const node: TFsNode | undefined = nodeById.get(currentId);
    if (node === undefined) {
      return false;
    }

    currentId = node.parentId;
  }

  return false;
};

// The header buttons create next to the selection: inside a selected folder, beside a
// selected file, and in the vault root when nothing is selected.
const readCreateParentId = (
  nodeById: ReadonlyMap<string, TFsNode>,
  selectedId: string | null
): string | null => {
  if (selectedId === null) {
    return null;
  }

  const node = nodeById.get(selectedId);
  if (node === undefined) {
    return null;
  }

  if (node.kind === "folder") {
    return node.id;
  }

  return node.parentId;
};

type TDraftInputProps = {
  initialName: string;
  // A file draft is named by the reader, extension included, and only an extension the
  // app knows names a kind. Every other draft already knows its kind and takes any name.
  isFileDraft: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
};

const DraftInput: FC<TDraftInputProps> = ({ initialName, isFileDraft, onCancel, onSubmit }) => {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  const isAllowed = !isFileDraft || readFileKind(name) !== null;

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) {
      return;
    }

    input.focus();

    // The stem is selected and the extension is left alone, so typing replaces the name
    // and keeps the kind.
    const dotIndex = initialName.lastIndexOf(".");

    input.setSelectionRange(0, dotIndex > 0 ? dotIndex : initialName.length);
  }, [initialName]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();

    if (event.key === "Enter") {
      if (!isAllowed) {
        return;
      }

      onSubmit(name);

      return;
    }

    if (event.key === "Escape") {
      onCancel();
    }
  };

  // Leaving an extension the app cannot read behind would only fail in the host, so the
  // draft is dropped instead.
  const handleBlur = () => {
    if (!isAllowed) {
      onCancel();

      return;
    }

    onSubmit(name);
  };

  return (
    <>
      <input
        className={`fs-viewer__input${isAllowed ? "" : " fs-viewer__input--invalid"}`}
        onBlur={handleBlur}
        onChange={(event) => setName(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        ref={inputRef}
        spellCheck={false}
        value={name}
      />

      {isFileDraft ? (
        <span className={`fs-viewer__ext${isAllowed ? "" : " fs-viewer__ext--invalid"}`}>
          {EXTENSIONS_HINT}
        </span>
      ) : null}
    </>
  );
};

const FsViewer: FC<TFsViewerProps> = ({
  nodes,
  expandedIds,
  selectedId,
  activeId,
  draft,
  isLoading = false,
  isBusy = false,
  error = null,
  registry,
}) => {
  const nodeById = useMemo(() => {
    return new Map(nodes.map((node) => [node.id, node]));
  }, [nodes]);

  const rows = useMemo(() => {
    return flattenTree(nodeById, expandedIds, draft);
  }, [nodeById, expandedIds, draft]);

  const [menu, setMenu] = useState<TMenuState | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (menu === null) {
      return;
    }

    const closeMenu = () => {
      setMenu(null);
    };

    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (menuRef.current !== null && target instanceof Node && menuRef.current.contains(target)) {
        return;
      }

      setMenu(null);
    };

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };

    window.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeMenu);

    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeMenu);
    };
  }, [menu]);

  const createParentId = readCreateParentId(nodeById, selectedId);

  const menuNode = menu === null || menu.nodeId === null
    ? null
    : nodeById.get(menu.nodeId) ?? null;

  // The root menu creates in the vault root, a folder menu creates inside that folder, and
  // a file menu creates nothing.
  const menuParentId = menuNode === null ? null : menuNode.id;
  const canCreateInMenu = menuNode === null || menuNode.kind === "folder";

  const canDropOn = (targetId: string | null) => {
    if (dragId === null) {
      return false;
    }

    const dragged = nodeById.get(dragId);
    if (dragged === undefined || dragged.parentId === targetId) {
      return false;
    }

    if (targetId === null) {
      return true;
    }

    return !isInsideSubtree(nodeById, targetId, dragId);
  };

  // A row keeps the event to itself. Letting it bubble would hand the body handler the
  // same drag and reset the target to the vault root.
  const handleDragOver = (event: DragEvent<HTMLElement>, targetId: string | null) => {
    if (!canDropOn(targetId)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    setDropId(targetId);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>, targetId: string | null) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    if (dropId === targetId) {
      setDropId(null);
    }
  };

  const handleDrop = (event: DragEvent<HTMLElement>, targetId: string | null) => {
    event.preventDefault();
    event.stopPropagation();

    const movedId = dragId;
    const isAllowed = canDropOn(targetId);

    setDragId(null);
    setDropId(null);

    if (movedId === null || !isAllowed) {
      return;
    }

    registry.moveNodeAction(movedId, targetId);
  };

  const handleContextMenu = (event: MouseEvent<HTMLElement>, nodeId: string | null) => {
    event.preventDefault();
    event.stopPropagation();

    if (nodeId !== null) {
      registry.selectNodeAction(nodeId);
    }

    // The menu is kept inside the window on the right; the browser keeps it on the left.
    const x = Math.min(event.clientX, window.innerWidth - MENU_WIDTH_PX - MENU_MARGIN_PX);

    setMenu({ nodeId, x, y: event.clientY, isConfirmingDelete: false });
  };

  const runMenuAction = (run: () => void) => {
    run();
    setMenu(null);
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLElement>, nodeId: string) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();

    registry.openNodeAction(nodeId);
  };

  return (
    <aside className="fs-viewer">
      <header className="fs-viewer__header">
        <span className="fs-viewer__title">{"Vault"}</span>

        <span className="fs-viewer__tools">
          <button
            className="fs-viewer__tool"
            disabled={isBusy}
            onClick={() => registry.startCreateAction(createParentId, "markdown")}
            title="New note"
            type="button"
          >
            <NewNoteIcon />
          </button>

          <button
            className="fs-viewer__tool"
            disabled={isBusy}
            onClick={() => registry.startCreateAction(createParentId, "excalidraw")}
            title="New sketch"
            type="button"
          >
            <NewSketchIcon />
          </button>

          <button
            className="fs-viewer__tool"
            disabled={isBusy}
            onClick={() => registry.startCreateAction(createParentId, "folder")}
            title="New folder"
            type="button"
          >
            <NewFolderIcon />
          </button>
        </span>
      </header>

      <div
        className={`fs-viewer__body${dropId === null && dragId !== null ? " fs-viewer__body--drop" : ""}`}
        onContextMenu={(event) => {
          if (event.target === event.currentTarget) {
            handleContextMenu(event, null);
          }
        }}
        onDragOver={(event) => {
          if (event.target === event.currentTarget) {
            handleDragOver(event, null);
          }
        }}
        onDrop={(event) => {
          if (event.target === event.currentTarget) {
            handleDrop(event, null);
          }
        }}
        role="tree"
      >
        {isLoading ? <p className="fs-viewer__hint">{"Reading the vault…"}</p> : null}

        {error === null ? null : <p className="fs-viewer__error">{error}</p>}

        <div className="fs-viewer__tree" role="presentation">
          {rows.map((row) => {
            if (row.type === "draft") {
              return (
                <div
                  className="fs-viewer__row fs-viewer__row--draft"
                  key="draft"
                  style={readIndentStyle(row.depth)}
                >
                  <span className="fs-viewer__twisty" />

                  <DraftIcon kind={row.kind} />

                  <DraftInput
                    initialName={NEW_NAME_BY_KIND[row.kind]}
                    isFileDraft={row.kind === "file"}
                    onCancel={registry.cancelDraftAction}
                    onSubmit={registry.submitDraftAction}
                  />
                </div>
              );
            }

            const node = row.node;
            const isRenaming = draft !== null
              && draft.mode === "rename"
              && draft.nodeId === node.id;

            const isFolder = node.kind === "folder";
            // Dropping on a file moves into the folder that holds the file.
            const dropTargetId = isFolder ? node.id : node.parentId;

            const modifiers = [
              node.id === activeId ? " fs-viewer__row--active" : "",
              node.id === selectedId ? " fs-viewer__row--selected" : "",
              node.id === dropId ? " fs-viewer__row--drop" : "",
              node.id === dragId ? " fs-viewer__row--dragging" : "",
            ].join("");

            return (
              <div
                aria-expanded={isFolder ? row.isExpanded : undefined}
                aria-selected={node.id === selectedId}
                className={`fs-viewer__row${modifiers}`}
                draggable={!isRenaming}
                key={node.id}
                onClick={() => registry.selectNodeAction(node.id)}
                onContextMenu={(event) => handleContextMenu(event, node.id)}
                onDoubleClick={() => registry.openNodeAction(node.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setDropId(null);
                }}
                onDragLeave={(event) => handleDragLeave(event, dropTargetId)}
                onDragOver={(event) => handleDragOver(event, dropTargetId)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", node.id);

                  setDragId(node.id);
                }}
                onDrop={(event) => handleDrop(event, dropTargetId)}
                onKeyDown={(event) => handleRowKeyDown(event, node.id)}
                role="treeitem"
                style={readIndentStyle(row.depth)}
                tabIndex={0}
              >
                <span
                  className="fs-viewer__twisty"
                  onClick={(event) => {
                    event.stopPropagation();

                    if (isFolder) {
                      registry.toggleFolderAction(node.id);
                    }
                  }}
                >
                  {isFolder ? <Chevron isExpanded={row.isExpanded} /> : null}
                </span>

                <NodeIcon kind={node.kind} />

                {isRenaming ? (
                  <DraftInput
                    initialName={node.name}
                    isFileDraft={false}
                    onCancel={registry.cancelDraftAction}
                    onSubmit={registry.submitDraftAction}
                  />
                ) : (
                  <span className="fs-viewer__name">{node.name}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {menu === null || (menu.nodeId !== null && menuNode === null) ? null : (
        <div
          className="fs-viewer__menu"
          ref={menuRef}
          role="menu"
          style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
        >
          {!canCreateInMenu ? null : (
            <>
              {CREATE_ITEMS.map((item) => (
                <button
                  className="fs-viewer__menu-item"
                  key={item.kind}
                  onClick={() => {
                    runMenuAction(() => registry.startCreateAction(menuParentId, item.kind));
                  }}
                  role="menuitem"
                  type="button"
                >
                  <DraftIcon kind={item.kind} />

                  {item.label}
                </button>
              ))}

              {menuNode === null ? null : <span className="fs-viewer__menu-divider" />}
            </>
          )}

          {menuNode === null ? null : (
            <>
              <button
                className="fs-viewer__menu-item"
                onClick={() => runMenuAction(() => registry.startRenameAction(menuNode.id))}
                role="menuitem"
                type="button"
              >
                {"Rename"}
              </button>

              {menuNode.parentId === null ? null : (
                <button
                  className="fs-viewer__menu-item"
                  onClick={() => runMenuAction(() => registry.moveNodeAction(menuNode.id, null))}
                  role="menuitem"
                  type="button"
                >
                  {"Move to vault root"}
                </button>
              )}

              <span className="fs-viewer__menu-divider" />

              {menu.isConfirmingDelete ? (
                <button
                  className="fs-viewer__menu-item fs-viewer__menu-item--danger"
                  onClick={() => runMenuAction(() => registry.deleteNodeAction(menuNode.id))}
                  role="menuitem"
                  type="button"
                >
                  {`Delete this ${LABEL_BY_KIND[menuNode.kind]}?`}
                </button>
              ) : (
                <button
                  className="fs-viewer__menu-item fs-viewer__menu-item--danger"
                  onClick={() => setMenu({ ...menu, isConfirmingDelete: true })}
                  role="menuitem"
                  type="button"
                >
                  {"Delete"}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
};

export { FsViewer };
export type { TFsDraft, TFsViewerProps, TFsViewerRegistrySlice } from "./fs-viewer.types";
