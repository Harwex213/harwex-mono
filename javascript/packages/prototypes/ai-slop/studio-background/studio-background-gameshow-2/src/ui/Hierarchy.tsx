import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useState } from "react";
import type * as THREE from "three";
import { selectedUuid } from "../state";
import styles from "./Editor.module.css";

interface HierarchyProps {
  root: THREE.Object3D;
}

interface NodeProps {
  object: THREE.Object3D;
  depth: number;
  expanded: Set<string>;
  toggle: (uuid: string) => void;
}

// Instanced meshes and anonymous helpers clutter the tree; only named objects are listed.
function visibleChildren(object: THREE.Object3D): THREE.Object3D[] {
  return object.children.filter((child) => child.name !== "");
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

function HierarchyNode(props: NodeProps) {
  useSignals();
  const { object, depth, expanded, toggle } = props;
  const children = visibleChildren(object);
  const isOpen = expanded.has(object.uuid);
  const isSelected = selectedUuid.value === object.uuid;
  const className = [styles.treeRow, isSelected ? styles.treeRowSelected : ""].join(" ");
  return (
    <>
      <div
        className={className}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => {
          selectedUuid.value = object.uuid;
        }}
        onDoubleClick={() => {
          toggle(object.uuid);
        }}
      >
        <span
          className={styles.treeArrow}
          onClick={(event) => {
            event.stopPropagation();
            toggle(object.uuid);
          }}
        >
          {children.length > 0 ? (isOpen ? "▾" : "▸") : ""}
        </span>
        <span className={styles.treeIcon}>{iconFor(object)}</span>
        <span className={styles.treeName}>{object.name}</span>
      </div>
      {isOpen
        ? children.map((child) => <HierarchyNode key={child.uuid} object={child} depth={depth + 1} expanded={expanded} toggle={toggle} />)
        : null}
    </>
  );
}

function Hierarchy(props: HierarchyProps) {
  useSignals();
  const { root } = props;
  const selected = selectedUuid.value;
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>([root.uuid]);
    for (const child of root.children) {
      initial.add(child.uuid);
    }
    return initial;
  });

  // A pick in the viewport opens the tree down to the picked object.
  useEffect(() => {
    const object = selected ? root.getObjectByProperty("uuid", selected) : undefined;
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
  }, [root, selected]);

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

  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <span className={styles.panelTitle}>Hierarchy</span>
      </header>
      <div className={styles.panelBody}>
        <HierarchyNode object={root} depth={0} expanded={expanded} toggle={toggle} />
      </div>
    </section>
  );
}

export { Hierarchy };
