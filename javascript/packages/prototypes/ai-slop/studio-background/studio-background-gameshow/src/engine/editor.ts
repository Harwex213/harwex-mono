import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { inspectorRevision, selectedUuid, transformMode } from "../state";
import { SceneNavigation } from "./sceneNavigation";

// Everything that only exists in the Scene view lives on this layer.
// The main camera renders layer 0 only, so the Game view never shows editor helpers.
const EDITOR_LAYER = 1;

interface EditorOptions {
  scene: THREE.Scene;
  root: THREE.Object3D;
  canvas: HTMLCanvasElement;
  mainCamera: THREE.PerspectiveCamera;
  save: () => void;
  // Called right before the gizmo starts to move an object, for undo.
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
}

function onEditorLayer(object: THREE.Object3D): void {
  object.traverse((child) => {
    child.layers.set(EDITOR_LAYER);
  });
}

// Selectable ancestors of a hit, outermost first. Folders only group objects and are skipped.
function selectableChain(object: THREE.Object3D | null, root: THREE.Object3D): THREE.Object3D[] {
  const chain: THREE.Object3D[] = [];
  let current = object;
  while (current && current !== root) {
    if (current.userData.selectable && !current.userData.folder) {
      chain.unshift(current);
    }
    current = current.parent;
  }
  return chain;
}

// The raycaster ignores visibility, so a mesh under a hidden group still gets hit.
function isShown(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) {
      return false;
    }
    current = current.parent;
  }
  return true;
}

// Like Unity: the first click selects the whole prop, the next click on it goes one level deeper.
function pickFromChain(chain: THREE.Object3D[], selected: string | null): THREE.Object3D | undefined {
  const index = chain.findIndex((object) => object.uuid === selected);
  if (index >= 0 && index < chain.length - 1) {
    return chain[index + 1];
  }
  if (index === chain.length - 1 && index >= 0) {
    return chain[index];
  }
  return chain[0];
}

function lightHelper(object: THREE.Object3D): THREE.Object3D | null {
  if ((object as THREE.SpotLight).isSpotLight) {
    return new THREE.SpotLightHelper(object as THREE.SpotLight, 0xffd27a);
  }
  if ((object as THREE.PointLight).isPointLight) {
    return new THREE.PointLightHelper(object as THREE.PointLight, 0.4, 0xffd27a);
  }
  if ((object as THREE.HemisphereLight).isHemisphereLight) {
    return new THREE.HemisphereLightHelper(object as THREE.HemisphereLight, 1);
  }
  return null;
}

class Editor {
  readonly camera: THREE.PerspectiveCamera;
  private readonly navigation: SceneNavigation;
  private readonly gizmo: TransformControls;
  private readonly selectionBox: THREE.BoxHelper;
  private readonly cameraHelper: THREE.CameraHelper;
  private light: THREE.Object3D | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly options: EditorOptions;
  private pointerDown = new THREE.Vector2();
  private enabled = true;

  constructor(options: EditorOptions) {
    this.options = options;
    const { scene, canvas, mainCamera } = options;

    // The far plane reaches past the city cylinder (400 m) so the backdrop stays visible from outside.
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
    this.camera.name = "Editor Camera";
    this.camera.layers.enable(EDITOR_LAYER);

    // Alt + LMB orbits the camera; the gizmo must not grab that click.
    // A capture listener runs before the gizmo's own listener.
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.altKey) {
          this.gizmo.enabled = false;
        }
      },
      { capture: true },
    );
    canvas.addEventListener("pointerup", () => {
      this.gizmo.enabled = this.enabled;
    });
    this.navigation = new SceneNavigation(this.camera, canvas);
    this.navigation.lookAt(new THREE.Vector3(26, 17, 30), new THREE.Vector3(0, 4, -4));

    const grid = new THREE.GridHelper(50, 50, 0x5b6170, 0x2c3038);
    grid.name = "Editor Grid";
    grid.position.y = 0.02;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.35;
    gridMaterial.depthWrite = false;
    onEditorLayer(grid);
    scene.add(grid);

    this.cameraHelper = new THREE.CameraHelper(mainCamera);
    this.cameraHelper.name = "Main Camera Gizmo";
    onEditorLayer(this.cameraHelper);
    scene.add(this.cameraHelper);

    this.selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffa424);
    this.selectionBox.name = "Selection Box";
    this.selectionBox.visible = false;
    onEditorLayer(this.selectionBox);
    scene.add(this.selectionBox);

    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(0.9);
    this.gizmo.getRaycaster().layers.enableAll();
    const gizmoHelper = this.gizmo.getHelper();
    gizmoHelper.name = "Transform Gizmo";
    onEditorLayer(gizmoHelper);
    scene.add(gizmoHelper);
    this.gizmo.addEventListener("dragging-changed", (event) => {
      this.navigation.enabled = this.enabled && !event.value;
    });
    // TransformControls fires `mouseDown` when a drag on an axis starts.
    this.gizmo.addEventListener("mouseDown", () => {
      this.options.checkpoint();
    });
    this.gizmo.addEventListener("objectChange", () => {
      inspectorRevision.value += 1;
    });

    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("keydown", this.handleKeyDown);

    transformMode.subscribe((mode) => {
      this.gizmo.setMode(mode);
    });
    selectedUuid.subscribe((uuid) => {
      this.applySelection(uuid);
    });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.navigation.enabled = enabled;
    this.gizmo.enabled = enabled;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    if (this.enabled) {
      this.navigation.update(dt);
    }
    this.cameraHelper.update();
    const selected = this.gizmo.object;
    if (selected) {
      this.selectionBox.setFromObject(selected);
    }
    (this.light as { update?: () => void } | null)?.update?.();
  }

  focusSelected(): void {
    const selected = this.gizmo.object;
    if (!selected) {
      return;
    }
    const box = new THREE.Box3().setFromObject(selected);
    // Lights and targets have no geometry: frame a small box around their position.
    if (box.isEmpty()) {
      box.setFromCenterAndSize(selected.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(2, 2, 2));
    }
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.5, box.getSize(new THREE.Vector3()).length() / 2);
    this.navigation.frame(center, radius);
  }

  private applySelection(uuid: string | null): void {
    const object = uuid ? this.options.root.getObjectByProperty("uuid", uuid) : undefined;
    if (this.light) {
      this.light.removeFromParent();
      (this.light as { dispose?: () => void }).dispose?.();
      this.light = null;
    }
    if (object) {
      this.gizmo.attach(object);
      this.selectionBox.setFromObject(object);
      this.selectionBox.visible = true;
      this.light = lightHelper(object);
      if (this.light) {
        onEditorLayer(this.light);
        this.options.scene.add(this.light);
      }
    } else {
      this.gizmo.detach();
      this.selectionBox.visible = false;
    }
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown.set(event.clientX, event.clientY);
  };

  // A click that did not drag selects the object under the cursor.
  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0 || event.altKey || this.gizmo.dragging) {
      return;
    }
    if (this.pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 4) {
      return;
    }
    if (this.gizmo.axis) {
      return;
    }
    const rect = this.options.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.options.root, true);
    for (const hit of hits) {
      if (!isShown(hit.object)) {
        continue;
      }
      const picked = pickFromChain(selectableChain(hit.object, this.options.root), selectedUuid.value);
      if (picked) {
        selectedUuid.value = picked.uuid;
        return;
      }
    }
    selectedUuid.value = null;
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const command = event.metaKey || event.ctrlKey;
    if (command && event.code === "KeyS") {
      event.preventDefault();
      this.options.save();
      return;
    }
    // A text field keeps its own undo.
    const typing = event.target instanceof HTMLInputElement && event.target.type !== "checkbox" && event.target.type !== "color";
    if (command && !typing && (event.code === "KeyZ" || event.code === "KeyY")) {
      event.preventDefault();
      if (event.code === "KeyY" || event.shiftKey) {
        this.options.redo();
      } else {
        this.options.undo();
      }
      return;
    }
    // While RMB is held, WASDQE fly the camera instead of switching tools.
    if (!this.enabled || typing || command || event.altKey || this.navigation.flying) {
      return;
    }
    if (event.code === "KeyW") {
      transformMode.value = "translate";
    } else if (event.code === "KeyE") {
      transformMode.value = "rotate";
    } else if (event.code === "KeyR") {
      transformMode.value = "scale";
    } else if (event.code === "KeyF") {
      this.focusSelected();
    } else if (event.code === "Escape") {
      selectedUuid.value = null;
    }
  };
}

export { EDITOR_LAYER, Editor };
