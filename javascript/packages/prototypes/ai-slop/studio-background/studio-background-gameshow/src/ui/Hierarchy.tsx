import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import { getEngine } from "../engine/engine";
import { ADD_ENTRIES } from "../engine/primitives";
import type { AddEntry } from "../engine/primitives";
import { namedChildren } from "../engine/sceneDocument";
import { editorHint, inspectorRevision, renamingUuid, selectedUuid, structureRevision } from "../state";
import styles from "./Editor.module.css";

interface HierarchyProps {
  root: THREE.Object3D;
}

type DropZone = "before" | "inside" | "after";

interface DropTarget {
  uuid: string;
  zone: DropZone;
}

interface MenuState {
  x: number;
  y: number;
  target: THREE.Object3D;
}

// The search: the rows to show (matches and their ancestors) and the rows that match.
interface SearchFilter {
  query: string;
  shown: Set<THREE.Object3D>;
  matches: Set<THREE.Object3D>;
}

interface TreeContext {
  root: THREE.Object3D;
  filter: SearchFilter | null;
  // Marks a selection made in the tree itself, so the tree does not scroll to it.
  selectFromTree: (uuid: string) => void;
  expanded: Set<string>;
  toggle: (uuid: string) => void;
  expand: (uuid: string) => void;
  dragged: THREE.Object3D | null;
  setDragged: (object: THREE.Object3D | null) => void;
  drop: DropTarget | null;
  setDrop: (drop: DropTarget | null) => void;
  openMenu: (state: MenuState) => void;
}

interface NodeProps {
  object: THREE.Object3D;
  depth: number;
  // True when an ancestor is hidden: the object is hidden too, whatever its own flag says.
  parentHidden: boolean;
  tree: TreeContext;
}

function iconFor(object: THREE.Object3D): string {
  if ((object as THREE.Light).isLight) {
    return "◉";
  }
  if ((object as THREE.Camera).isCamera) {
    return "▣";
  }
  if ((object as THREE.Mesh).isMesh) {
    return "◆";
  }
  return "▢";
}

function isInside(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function buildFilter(root: THREE.Object3D, query: string): SearchFilter | null {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return null;
  }
  const shown = new Set<THREE.Object3D>([root]);
  const matches = new Set<THREE.Object3D>();
  const visit = (object: THREE.Object3D): boolean => {
    let any = false;
    for (const child of namedChildren(object)) {
      if (visit(child)) {
        any = true;
      }
    }
    if (object !== root && object.name.toLowerCase().includes(needle)) {
      matches.add(object);
      any = true;
    }
    if (any) {
      shown.add(object);
    }
    return any;
  };
  visit(root);
  return { query: needle, shown, matches };
}

// The name with every match of the search marked.
function HighlightedName(props: { name: string; query: string }) {
  const { name, query } = props;
  const parts: { text: string; hit: boolean }[] = [];
  const lower = name.toLowerCase();
  let start = 0;
  let at = lower.indexOf(query);
  while (at >= 0) {
    if (at > start) {
      parts.push({ text: name.slice(start, at), hit: false });
    }
    parts.push({ text: name.slice(at, at + query.length), hit: true });
    start = at + query.length;
    at = lower.indexOf(query, start);
  }
  if (start < name.length) {
    parts.push({ text: name.slice(start), hit: false });
  }
  return (
    <>
      {parts.map((part, index) =>
        part.hit ? (
          <mark key={index} className={styles.searchHit}>
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function EyeIcon(props: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 8 C3.5 4.5 5.8 3.2 8 3.2 C10.2 3.2 12.5 4.5 14.5 8 C12.5 11.5 10.2 12.8 8 12.8 C5.8 12.8 3.5 11.5 1.5 8 Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2.2" fill="currentColor" />
      {props.open ? null : <path d="M2.5 13.5 L13.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  );
}

// Where a drop on `zone` of `target` puts the dragged object: the new parent and the place among its named children.
function dropPlacement(target: THREE.Object3D, zone: DropZone, dragged: THREE.Object3D, expanded: Set<string>): { parent: THREE.Object3D; index: number } | null {
  const children = namedChildren(target).filter((child) => child !== dragged);
  // Below an open parent the line sits above its first child, so the drop goes there, like in Unity.
  if (zone === "inside" || (zone === "after" && expanded.has(target.uuid) && children.length > 0)) {
    return { parent: target, index: zone === "inside" ? children.length : 0 };
  }
  const parent = target.parent;
  if (!parent) {
    return null;
  }
  const siblings = namedChildren(parent).filter((child) => child !== dragged);
  return { parent, index: siblings.indexOf(target) + (zone === "after" ? 1 : 0) };
}

function RenameField(props: { object: THREE.Object3D }) {
  const { object } = props;
  const [text, setText] = useState(object.name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function finish(commit: boolean): void {
    if (done.current) {
      return;
    }
    done.current = true;
    if (commit) {
      getEngine().document.rename(object, text);
    }
    renamingUuid.value = null;
  }

  return (
    <input
      ref={ref}
      className={styles.renameInput}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          finish(true);
        } else if (event.key === "Escape") {
          finish(false);
        }
      }}
      onBlur={() => {
        finish(true);
      }}
    />
  );
}

function HierarchyNode(props: NodeProps) {
  useSignals();
  const { object, depth, parentHidden, tree } = props;
  const sceneDocument = getEngine().document;
  const filter = tree.filter;
  const children = filter ? namedChildren(object).filter((child) => filter.shown.has(child)) : namedChildren(object);
  // While searching, every shown row is open: the matches hang under their ancestors.
  const isOpen = filter ? true : tree.expanded.has(object.uuid);
  const isSelected = selectedUuid.value === object.uuid;
  const isRenaming = renamingUuid.value === object.uuid;
  const isRoot = object === tree.root;
  const locked = sceneDocument.lockReason(object) !== null;
  const drop = tree.drop?.uuid === object.uuid ? tree.drop.zone : null;
  const className = [
    styles.treeRow,
    isSelected ? styles.treeRowSelected : "",
    !object.visible ? styles.treeRowHidden : parentHidden ? styles.treeRowHiddenByParent : "",
    tree.dragged === object ? styles.treeRowDragged : "",
    filter && !filter.matches.has(object) ? styles.treeRowContext : "",
    drop === "inside" ? styles.treeRowDropInside : "",
    drop === "before" ? styles.treeRowDropBefore : "",
    drop === "after" ? styles.treeRowDropAfter : "",
  ].join(" ");
  const eyeTitle = !object.visible ? "Hidden. Click to show" : parentHidden ? "Hidden by a parent" : "Click to hide";

  return (
    <>
      <div
        className={className}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable={!locked && !isRenaming}
        data-uuid={object.uuid}
        onClick={() => {
          tree.selectFromTree(object.uuid);
        }}
        onDoubleClick={() => {
          if (!isRoot) {
            tree.selectFromTree(object.uuid);
            renamingUuid.value = object.uuid;
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          tree.selectFromTree(object.uuid);
          tree.openMenu({ x: event.clientX, y: event.clientY, target: object });
        }}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", object.uuid);
          tree.setDragged(object);
        }}
        onDragEnd={() => {
          tree.setDragged(null);
          tree.setDrop(null);
        }}
        onDragOver={(event) => {
          const dragged = tree.dragged;
          if (!dragged || isInside(object, dragged)) {
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const share = (event.clientY - rect.top) / rect.height;
          const zone: DropZone = isRoot ? "inside" : share < 0.25 ? "before" : share > 0.75 ? "after" : "inside";
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (tree.drop?.uuid !== object.uuid || tree.drop.zone !== zone) {
            tree.setDrop({ uuid: object.uuid, zone });
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          const dragged = tree.dragged;
          const zone = tree.drop?.uuid === object.uuid ? tree.drop.zone : "inside";
          tree.setDragged(null);
          tree.setDrop(null);
          if (!dragged || isInside(object, dragged)) {
            return;
          }
          const placement = dropPlacement(object, zone, dragged, tree.expanded);
          if (placement && sceneDocument.move(dragged, placement.parent, placement.index)) {
            tree.expand(placement.parent.uuid);
            tree.selectFromTree(dragged.uuid);
          }
        }}
      >
        <span
          className={styles.treeArrow}
          onClick={(event) => {
            event.stopPropagation();
            tree.toggle(object.uuid);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
          }}
        >
          {children.length > 0 ? (isOpen ? "▾" : "▸") : ""}
        </span>
        <span className={styles.treeIcon}>{iconFor(object)}</span>
        {isRenaming ? <RenameField object={object} /> : <span className={styles.treeName}>{filter && filter.matches.has(object) ? <HighlightedName name={object.name} query={filter.query} /> : object.name}</span>}
        {isRoot ? null : (
          <span
            className={[styles.treeEye, !object.visible ? styles.treeEyeOff : parentHidden ? styles.treeEyeInherited : ""].join(" ")}
            title={eyeTitle}
            onClick={(event) => {
              event.stopPropagation();
              sceneDocument.setVisible(object, !object.visible);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
            }}
          >
            <EyeIcon open={object.visible && !parentHidden} />
          </span>
        )}
      </div>
      {isOpen
        ? children.map((child) => <HierarchyNode key={child.uuid} object={child} depth={depth + 1} parentHidden={parentHidden || !object.visible} tree={tree} />)
        : null}
    </>
  );
}

const SECTIONS: { title: string; note: string; entries: AddEntry[] }[] = [
  { title: "", note: "", entries: ADD_ENTRIES.filter((entry) => entry.section === "Empty") },
  { title: "Mesh", note: "", entries: ADD_ENTRIES.filter((entry) => entry.section === "Mesh") },
  {
    title: "Light",
    note: "Each light costs frame time in every shot of its room",
    entries: ADD_ENTRIES.filter((entry) => entry.section === "Light"),
  },
];

function ContextMenu(props: { menu: MenuState; close: () => void; expand: (uuid: string) => void }) {
  const { menu, close, expand } = props;
  const engine = getEngine();
  const { target } = menu;
  const lock = engine.document.lockReason(target);
  const isRoot = target === engine.root;
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: menu.x, y: menu.y });

  // Keeps the menu inside the window.
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const rect = element.getBoundingClientRect();
    setPosition({
      x: Math.min(menu.x, window.innerWidth - rect.width - 4),
      y: Math.max(4, Math.min(menu.y, window.innerHeight - rect.height - 4)),
    });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [close]);

  return (
    <div
      className={styles.menuOverlay}
      onPointerDown={close}
      onContextMenu={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div
        ref={ref}
        className={styles.menu}
        style={{ left: position.x, top: position.y }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
      >
        <div className={styles.menuCaption}>Add under {target.name}</div>
        {SECTIONS.map((section) => (
          <div key={section.title} className={styles.menuSection}>
            {section.title !== "" ? (
              <div className={styles.menuTitle} title={section.note}>
                {section.title}
                {section.note !== "" ? <span className={styles.menuNote}> · {section.note}</span> : null}
              </div>
            ) : null}
            {section.entries.map((entry) => (
              <button
                key={entry.kind}
                type="button"
                className={styles.menuItem}
                data-kind={entry.kind}
                onClick={() => {
                  const object = engine.add(entry.kind, target);
                  if (object) {
                    expand(target.uuid);
                  }
                  close();
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
        ))}
        <div className={styles.menuSection}>
          <button
            type="button"
            className={styles.menuItem}
            disabled={isRoot}
            onClick={() => {
              selectedUuid.value = target.uuid;
              renamingUuid.value = target.uuid;
              close();
            }}
          >
            Rename<span className={styles.menuShortcut}>F2</span>
          </button>
          <button
            type="button"
            className={styles.menuItem}
            disabled={lock !== null}
            title={lock ? `Cannot delete: ${lock}` : "Delete the object and its children"}
            onClick={() => {
              engine.document.remove(target);
              close();
            }}
          >
            Delete<span className={styles.menuShortcut}>Del</span>
          </button>
          {lock ? <div className={styles.menuLock}>Locked: {lock}</div> : null}
        </div>
      </div>
    </div>
  );
}

function Hierarchy(props: HierarchyProps) {
  useSignals();
  const { root } = props;
  const selected = selectedUuid.value;
  // Reading the revisions re-renders the tree after an add, delete, move, rename or a visibility change.
  void structureRevision.value;
  void inspectorRevision.value;
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>([root.uuid]);
    for (const child of root.children) {
      initial.add(child.uuid);
    }
    return initial;
  });
  const [dragged, setDragged] = useState<THREE.Object3D | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // The last selection made in the tree itself: the tree does not jump to it.
  const treeSelection = useRef<string | null>(null);
  // A row to scroll to the middle of the tree after the next render.
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const filter = buildFilter(root, query);

  function selectFromTree(uuid: string): void {
    treeSelection.current = uuid;
    selectedUuid.value = uuid;
  }

  function reveal(uuid: string): void {
    const object = root.getObjectByProperty("uuid", uuid);
    if (!object) {
      return;
    }
    setExpanded((previous) => {
      const next = new Set(previous);
      let parent = object.parent;
      while (parent) {
        next.add(parent.uuid);
        parent = parent.parent;
      }
      return next;
    });
    setScrollTarget(uuid);
  }

  // A pick in the viewport (or any selection from outside the tree) opens the tree down to the picked object
  // and scrolls its row to the middle of the tree.
  useEffect(() => {
    const fromTree = selected === treeSelection.current;
    treeSelection.current = null;
    if (selected && !fromTree) {
      reveal(selected);
    }
  }, [root, selected]);

  useEffect(() => {
    if (!scrollTarget) {
      return;
    }
    const element = bodyRef.current?.querySelector(`[data-uuid="${scrollTarget}"]`);
    if (element) {
      element.scrollIntoView({ block: "center" });
      setScrollTarget(null);
    }
  });

  // Ctrl+F (Cmd+F) focuses the search, unless a text field has the focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyF" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Clearing the search keeps the selection in sight.
  function clearSearch(): void {
    setQuery("");
    const uuid = selectedUuid.peek();
    if (uuid) {
      reveal(uuid);
    }
  }

  function toggle(uuid: string): void {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(uuid)) {
        next.delete(uuid);
      } else {
        next.add(uuid);
      }
      return next;
    });
  }

  function expand(uuid: string): void {
    setExpanded((previous) => {
      if (previous.has(uuid)) {
        return previous;
      }
      return new Set(previous).add(uuid);
    });
  }

  const closeMenu = (): void => {
    setMenu(null);
  };

  const tree: TreeContext = { root, filter, selectFromTree, expanded, toggle, expand, dragged, setDragged, drop, setDrop, openMenu: setMenu };

  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <span className={styles.panelTitle}>Hierarchy</span>
        <button
          type="button"
          className={styles.headerButton}
          title="Add an object under the selected one"
          onClick={(event) => {
            const object = selected ? root.getObjectByProperty("uuid", selected) : undefined;
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ x: rect.left, y: rect.bottom + 2, target: object ?? root });
          }}
        >
          + Add
        </button>
      </header>
      <div className={styles.searchBar}>
        <input
          ref={searchRef}
          className={styles.searchInput}
          placeholder="Search (Ctrl+F)"
          value={query}
          onChange={(event) => {
            if (event.target.value === "") {
              clearSearch();
            } else {
              setQuery(event.target.value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              clearSearch();
              event.currentTarget.blur();
            }
          }}
        />
        {query !== "" ? (
          <button type="button" className={styles.searchClear} title="Clear the search (Esc)" onClick={clearSearch}>
            ×
          </button>
        ) : null}
      </div>
      {filter && filter.matches.size === 0 ? <div className={styles.emptyHint}>No object matches “{query}”.</div> : null}
      <div
        ref={bodyRef}
        className={styles.panelBody}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY, target: root });
        }}
      >
        <HierarchyNode object={root} depth={0} parentHidden={false} tree={tree} />
      </div>
      {editorHint.value !== "" ? <div className={styles.hint}>{editorHint.value}</div> : null}
      <div className={styles.panelFooter}>Drag to reparent · F2 rename · Del delete · right-click to add</div>
      {menu ? <ContextMenu menu={menu} close={closeMenu} expand={expand} /> : null}
    </section>
  );
}

export { Hierarchy };
