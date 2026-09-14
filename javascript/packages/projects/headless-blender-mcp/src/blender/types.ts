/**
 * What the harness's `shared/types.ts` held about Blender itself, kept here so
 * the package stands on its own.
 */

/** Where a headless Blender is in its life. */
type BlenderStatus = "starting" | "ready" | "stopped" | "failed";

/** One object of the Blender scene, as the outliner shows it. */
interface SceneObject {
  name: string;
  /** Blender's object type: `MESH`, `LIGHT`, `CAMERA`, `EMPTY`… */
  type: string;
  parent: string | null;
  dataName: string | null;
  /** Visible in the view layer, after collections and its own flag. */
  visible: boolean;
  /** Its own eye is closed. */
  hidden: boolean;
  /** For a collection instance, the collection it stands for. */
  instanceCollection: string | null;
}

/** One collection of the Blender scene, with what sits in it. */
interface SceneCollection {
  name: string;
  /** Unticked in the outliner: out of the view layer entirely. */
  excluded: boolean;
  hidden: boolean;
  objects: SceneObject[];
  children: SceneCollection[];
}

/** The collection and object tree of a scene. */
interface SceneOutline {
  sceneName: string;
  activeObject: string | null;
  collections: SceneCollection[];
}

export type { BlenderStatus, SceneCollection, SceneObject, SceneOutline };
