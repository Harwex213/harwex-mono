import { useState } from "react";
import type { SceneCollection, SceneObject, SceneOutline } from "../../../shared/types.js";
import { belongsToObject } from "./scene.js";

interface Props {
  outline: SceneOutline | null;
  error: string;
  loading: boolean;
  /** Names of the nodes the viewer holds. Only those can be selected. */
  nodeNames: string[];
  /** The node selected in the viewer, by name. */
  selectedName: string | null;
  onSelect(name: string | null): void;
  onRefresh(): void;
}

/** Short badges instead of Blender's icons, one per object type. */
const BADGES: Record<string, string> = {
  MESH: "mesh",
  LIGHT: "light",
  CAMERA: "cam",
  EMPTY: "empty",
  CURVE: "curve",
  SURFACE: "surf",
  META: "meta",
  FONT: "text",
  ARMATURE: "rig",
  LATTICE: "lat",
  GPENCIL: "gp",
  GREASEPENCIL: "gp",
  SPEAKER: "snd",
  VOLUME: "vol",
  POINTCLOUD: "pts",
};

function badgeOf(type: string): string {
  return BADGES[type] ?? type.toLowerCase();
}

function Row({
  object,
  depth,
  selectable,
  selected,
  onSelect,
}: {
  object: SceneObject;
  depth: number;
  selectable: boolean;
  selected: boolean;
  onSelect(name: string | null): void;
}): React.JSX.Element {
  const classes = ["outline__object"];
  if (selected) {
    classes.push("outline__object--selected");
  }
  if (!object.visible) {
    classes.push("outline__object--off");
  }
  if (!selectable) {
    classes.push("outline__object--absent");
  }
  const title = selectable
    ? `Select ${object.name} in the viewer`
    : `${object.name} is in the file but not in the preview: the export leaves lights and cameras out`;
  return (
    <button
      type="button"
      className={classes.join(" ")}
      style={{ paddingLeft: `${depth * 12 + 6}px` }}
      title={title}
      disabled={!selectable}
      onClick={() => {
        onSelect(selected ? null : object.name);
      }}
    >
      <span className="outline__badge">{badgeOf(object.type)}</span>
      <span className="outline__label">{object.name}</span>
      {object.instanceCollection ? <span className="outline__note">→ {object.instanceCollection}</span> : null}
      {object.hidden ? <span className="outline__note">hidden</span> : null}
    </button>
  );
}

function Branch({
  collection,
  depth,
  nodeNames,
  selectedName,
  onSelect,
}: {
  collection: SceneCollection;
  depth: number;
  nodeNames: string[];
  selectedName: string | null;
  onSelect(name: string | null): void;
}): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const count = collection.objects.length + collection.children.length;
  const classes = ["outline__collection"];
  if (collection.excluded || collection.hidden) {
    classes.push("outline__collection--off");
  }
  return (
    <div>
      <button
        type="button"
        className={classes.join(" ")}
        style={{ paddingLeft: `${depth * 12 + 2}px` }}
        title={collection.excluded ? `${collection.name} is out of the view layer` : collection.name}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span className="outline__arrow">{count === 0 ? "·" : open ? "▾" : "▸"}</span>
        <span className="outline__label">{collection.name}</span>
        {collection.excluded ? <span className="outline__note">excluded</span> : null}
      </button>
      {open ? (
        <div>
          {collection.children.map((child) => {
            return (
              <Branch
                key={child.name}
                collection={child}
                depth={depth + 1}
                nodeNames={nodeNames}
                selectedName={selectedName}
                onSelect={onSelect}
              />
            );
          })}
          {collection.objects.map((object) => {
            return (
              <Row
                key={object.name}
                object={object}
                depth={depth + 1}
                selectable={nodeNames.includes(object.name)}
                selected={selectedName !== null && belongsToObject(selectedName, object.name)}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The scene as Blender's outliner has it: collections, nested collections and
 * their objects, read from the tab's Blender rather than from the glTF the
 * viewer renders. So lights, cameras and empties are listed too, even though
 * the preview has none of them; pressing a mesh selects it in the viewer and
 * brings it into view.
 */
function OutlinePanel({
  outline,
  error,
  loading,
  nodeNames,
  selectedName,
  onSelect,
  onRefresh,
}: Props): React.JSX.Element {
  return (
    <aside className="outline">
      <div className="outline__title">
        <span>Objects</span>
        <button
          type="button"
          className="button button--small"
          title="Read the tree from Blender again"
          disabled={loading}
          onClick={onRefresh}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>
      {outline ? <small className="outline__scene">scene: {outline.sceneName}</small> : null}
      {error.length > 0 ? <p className="outline__empty">{error}</p> : null}
      {!outline && error.length === 0 ? <p className="outline__empty">Reading the scene…</p> : null}
      {outline?.collections.map((collection) => {
        return (
          <Branch
            key={collection.name}
            collection={collection}
            depth={0}
            nodeNames={nodeNames}
            selectedName={selectedName}
            onSelect={onSelect}
          />
        );
      })}
    </aside>
  );
}

export { OutlinePanel };
