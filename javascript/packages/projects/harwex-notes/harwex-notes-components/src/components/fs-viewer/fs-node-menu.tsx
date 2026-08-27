import { useEffect, useRef } from "react";
import type { FC } from "react";
import type { TFsNode, TFsNodeKind } from "@hw/harwex-notes-protocol";
import { DraftIcon } from "./fs-icons";
import type { TFsViewerRegistrySlice } from "./fs-viewer.types";

const MENU_WIDTH_PX = 176;
const MENU_MARGIN_PX = 8;

const CREATE_ITEMS: readonly { kind: TFsNodeKind; label: string }[] = [
  { kind: "file", label: "New file" },
  { kind: "excalidraw", label: "New excalidraw" },
  { kind: "folder", label: "New folder" },
];

const LABEL_BY_KIND: Readonly<Record<TFsNodeKind, string>> = {
  folder: "folder",
  markdown: "note",
  excalidraw: "sketch",
  file: "file",
};

// The menu is kept inside the window on the right; the browser keeps it on the left.
const clampMenuX = (clientX: number) => {
  return Math.min(clientX, window.innerWidth - MENU_WIDTH_PX - MENU_MARGIN_PX);
};

type TFsNodeMenuProps = {
  // The vault root is not a node, so the root menu has none. The root menu only creates.
  node: TFsNode | null;
  x: number;
  y: number;
  isConfirmingDelete: boolean;
  onConfirmDelete: () => void;
  onClose: () => void;
  registry: Pick<
    TFsViewerRegistrySlice,
    "startCreateAction" | "startRenameAction" | "moveNodeAction" | "deleteNodeAction"
  >;
};

const FsNodeMenu: FC<TFsNodeMenuProps> = ({
  node,
  x,
  y,
  isConfirmingDelete,
  onConfirmDelete,
  onClose,
  registry,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (menuRef.current !== null && target instanceof Node && menuRef.current.contains(target)) {
        return;
      }

      onClose();
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", onClose);

    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  // The root menu creates in the vault root, a folder menu creates inside that folder, and
  // a file menu creates nothing.
  const createParentId = node === null ? null : node.id;
  const canCreate = node === null || node.kind === "folder";

  const runAction = (run: () => void) => {
    run();
    onClose();
  };

  return (
    <div
      className="fs-viewer__menu"
      ref={menuRef}
      role="menu"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      {!canCreate ? null : (
        <>
          {CREATE_ITEMS.map((item) => (
            <button
              className="fs-viewer__menu-item"
              key={item.kind}
              onClick={() => {
                runAction(() => registry.startCreateAction(createParentId, item.kind));
              }}
              role="menuitem"
              type="button"
            >
              <DraftIcon kind={item.kind} />

              {item.label}
            </button>
          ))}

          {node === null ? null : <span className="fs-viewer__menu-divider" />}
        </>
      )}

      {node === null ? null : (
        <>
          <button
            className="fs-viewer__menu-item"
            onClick={() => runAction(() => registry.startRenameAction(node.id))}
            role="menuitem"
            type="button"
          >
            {"Rename"}
          </button>

          {node.parentId === null ? null : (
            <button
              className="fs-viewer__menu-item"
              onClick={() => runAction(() => registry.moveNodeAction(node.id, null))}
              role="menuitem"
              type="button"
            >
              {"Move to vault root"}
            </button>
          )}

          <span className="fs-viewer__menu-divider" />

          {isConfirmingDelete ? (
            <button
              className="fs-viewer__menu-item fs-viewer__menu-item--danger"
              onClick={() => runAction(() => registry.deleteNodeAction(node.id))}
              role="menuitem"
              type="button"
            >
              {`Delete this ${LABEL_BY_KIND[node.kind]}?`}
            </button>
          ) : (
            <button
              className="fs-viewer__menu-item fs-viewer__menu-item--danger"
              onClick={onConfirmDelete}
              role="menuitem"
              type="button"
            >
              {"Delete"}
            </button>
          )}
        </>
      )}
    </div>
  );
};

export { FsNodeMenu, clampMenuX };
export type { TFsNodeMenuProps };
