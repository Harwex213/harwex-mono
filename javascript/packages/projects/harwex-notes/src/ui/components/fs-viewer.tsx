import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import {
  Chevron,
  NewFolderIcon,
  NewNoteIcon,
  NewSketchIcon,
  NodeIcon,
} from "./fs-icons";
import { useStore } from "../../store/store";
import type { DragEvent, FC, KeyboardEvent, MouseEvent } from "react";
import type { TFsNode, TFsNodeKind } from "../../api/types";
import type {
  TCancelDraftAction,
  TDeleteNodeAction,
  TMoveNodeAction,
  TOpenNodeAction,
  TSelectNodeAction,
  TStartCreateAction,
  TStartRenameAction,
  TSubmitDraftAction,
  TToggleFolderAction,
} from "../../domain/registry";

type TFsViewerRegistrySlice = {
  toggleFolderAction: TToggleFolderAction;
  openNodeAction: TOpenNodeAction;
  selectNodeAction: TSelectNodeAction;
  startCreateAction: TStartCreateAction;
  startRenameAction: TStartRenameAction;
  cancelDraftAction: TCancelDraftAction;
  submitDraftAction: TSubmitDraftAction;
  moveNodeAction: TMoveNodeAction;
  deleteNodeAction: TDeleteNodeAction;
};

type TFsViewerProps = {
  registry: TFsViewerRegistrySlice;
};

type TMenuState = {
  nodeId: string;
  x: number;
  y: number;
  isConfirmingDelete: boolean;
};

const INDENT_STEP_PX = 14;
const MENU_WIDTH_PX = 176;
const MENU_MARGIN_PX = 8;

const NEW_NAME_BY_KIND: Readonly<Record<TFsNodeKind, string>> = {
  folder: "new-folder",
  markdown: "untitled.md",
  excalidraw: "untitled.excalidraw",
};

const LABEL_BY_KIND: Readonly<Record<TFsNodeKind, string>> = {
  folder: "folder",
  markdown: "note",
  excalidraw: "sketch",
};

const readIndentStyle = (depth: number) => ({
  paddingLeft: `${8 + depth * INDENT_STEP_PX}px`,
});

// Walks up from the candidate. A folder cannot swallow itself or one of its own
// parents, so a drop on such a target is refused before it reaches the api.
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
  onCancel: () => void;
  onSubmit: (name: string) => void;
};

const DraftInput: FC<TDraftInputProps> = ({ initialName, onCancel, onSubmit }) => {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) {
      return;
    }

    input.focus();

    const dotIndex = initialName.lastIndexOf(".");

    input.setSelectionRange(0, dotIndex > 0 ? dotIndex : initialName.length);
  }, [initialName]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();

    if (event.key === "Enter") {
      onSubmit(name);

      return;
    }

    if (event.key === "Escape") {
      onCancel();
    }
  };

  return (
    <input
      className="fs__input"
      onBlur={() => onSubmit(name)}
      onChange={(event) => setName(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      ref={inputRef}
      spellCheck={false}
      value={name}
    />
  );
};

const FsViewer: FC<TFsViewerProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const rows = store.derived.rows.value;
  const nodeById = store.derived.nodeById.value;
  const isLoading = store.fs.isLoading.value;
  const isBusy = store.fs.isBusy.value;
  const error = store.fs.error.value;
  const selectedId = store.fs.selectedId.value;
  const draft = store.fs.draft.value;
  const activeId = store.tabs.activeId.value;

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

  const menuNode = menu === null ? null : nodeById.get(menu.nodeId) ?? null;

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

  // A row keeps the event to itself. Letting it bubble would hand the body
  // handler the same drag and reset the target to the vault root.
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

  const handleContextMenu = (event: MouseEvent<HTMLElement>, nodeId: string) => {
    event.preventDefault();
    event.stopPropagation();

    registry.selectNodeAction(nodeId);

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
    <aside className="fs">
      <header className="fs__header">
        <span className="fs__title">{"Vault"}</span>

        <span className="fs__tools">
          <button
            className="fs__tool"
            disabled={isBusy}
            onClick={() => registry.startCreateAction(createParentId, "markdown")}
            title="New note"
            type="button"
          >
            <NewNoteIcon />
          </button>

          <button
            className="fs__tool"
            disabled={isBusy}
            onClick={() => registry.startCreateAction(createParentId, "excalidraw")}
            title="New sketch"
            type="button"
          >
            <NewSketchIcon />
          </button>

          <button
            className="fs__tool"
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
        className={`fs__body${dropId === null && dragId !== null ? " fs__body--drop" : ""}`}
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
      >
        {isLoading ? <p className="fs__hint">{"Reading the vault…"}</p> : null}

        {error === null ? null : <p className="fs__error">{error}</p>}

        {rows.map((row) => {
          if (row.type === "draft") {
            return (
              <div
                className="fs__row fs__row--draft"
                key="draft"
                style={readIndentStyle(row.depth)}
              >
                <span className="fs__twisty" />

                <NodeIcon kind={row.kind} />

                <DraftInput
                  initialName={NEW_NAME_BY_KIND[row.kind]}
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
          const dropTargetId = isFolder ? node.id : node.parentId;

          const modifiers = [
            node.id === activeId ? " fs__row--active" : "",
            node.id === selectedId ? " fs__row--selected" : "",
            node.id === dropId ? " fs__row--drop" : "",
            node.id === dragId ? " fs__row--dragging" : "",
          ].join("");

          return (
            <div
              className={`fs__row${modifiers}`}
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
                className="fs__twisty"
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
                  onCancel={registry.cancelDraftAction}
                  onSubmit={registry.submitDraftAction}
                />
              ) : (
                <span className="fs__name">{node.name}</span>
              )}
            </div>
          );
        })}
      </div>

      {menu === null || menuNode === null ? null : (
        <div
          className="fs__menu"
          ref={menuRef}
          style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
        >
          {menuNode.kind !== "folder" ? null : (
            <>
              <button
                className="fs__menu-item"
                onClick={() => {
                  runMenuAction(() => registry.startCreateAction(menuNode.id, "markdown"));
                }}
                type="button"
              >
                {"New note"}
              </button>

              <button
                className="fs__menu-item"
                onClick={() => {
                  runMenuAction(() => registry.startCreateAction(menuNode.id, "excalidraw"));
                }}
                type="button"
              >
                {"New sketch"}
              </button>

              <button
                className="fs__menu-item"
                onClick={() => {
                  runMenuAction(() => registry.startCreateAction(menuNode.id, "folder"));
                }}
                type="button"
              >
                {"New folder"}
              </button>

              <span className="fs__menu-divider" />
            </>
          )}

          <button
            className="fs__menu-item"
            onClick={() => runMenuAction(() => registry.startRenameAction(menuNode.id))}
            type="button"
          >
            {"Rename"}
          </button>

          {menuNode.parentId === null ? null : (
            <button
              className="fs__menu-item"
              onClick={() => runMenuAction(() => registry.moveNodeAction(menuNode.id, null))}
              type="button"
            >
              {"Move to vault root"}
            </button>
          )}

          <span className="fs__menu-divider" />

          {menu.isConfirmingDelete ? (
            <button
              className="fs__menu-item fs__menu-item--danger"
              onClick={() => runMenuAction(() => registry.deleteNodeAction(menuNode.id))}
              type="button"
            >
              {`Delete this ${LABEL_BY_KIND[menuNode.kind]}?`}
            </button>
          ) : (
            <button
              className="fs__menu-item fs__menu-item--danger"
              onClick={() => setMenu({ ...menu, isConfirmingDelete: true })}
              type="button"
            >
              {"Delete"}
            </button>
          )}
        </div>
      )}
    </aside>
  );
};

export { FsViewer };
