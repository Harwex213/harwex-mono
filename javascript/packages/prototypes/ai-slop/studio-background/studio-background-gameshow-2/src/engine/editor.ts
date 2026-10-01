import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { inspectorRevision, selectedUuid, transformMode } from "../state";

// Everything that only exists in the Scene view lives on this layer.
// The main camera renders layer 0 only, so the Game view never shows editor helpers.
const EDITOR_LAYER = 1;

interface EditorOptions {
  scene: THREE.Scene;
  root: THREE.Object3D;
  canvas: HTMLCanvasElement;
  mainCamera: THREE.PerspectiveCamera;
}

function onEditorLayer(object: THREE.Object3D): void {
  object.traverse((child) => {
    child.layers.set(EDITOR_LAYER);
  });
}

function findSelectable(object: THREE.Object3D | null, root: THREE.Object3D): THREE.Object3D | null {
  let current = object;
  while (current && current !== root) {
    if (current.userData.selectable) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

class Editor {
  readonly camera: THREE.PerspectiveCamera;
  private readonly orbit: OrbitControls;
  private readonly gizmo: TransformControls;
  private readonly selectionBox: THREE.BoxHelper;
  private readonly cameraHelper: THREE.CameraHelper;
  private readonly raycaster = new THREE.Raycaster();
  private readonly options: EditorOptions;
  private pointerDown = new THREE.Vector2();
  private enabled = true;

  constructor(options: EditorOptions) {
    this.options = options;
    const { scene, canvas, mainCamera } = options;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    this.camera.name = "Editor Camera";
    this.camera.position.set(22, 14, 30);
    this.camera.layers.enable(EDITOR_LAYER);

    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.target.set(0, 3.5, -2);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.update();

    const grid = new THREE.GridHelper(40, 40, 0x5b6170, 0x2c3038);
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
      this.orbit.enabled = !event.value;
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
    this.orbit.enabled = enabled;
    this.gizmo.enabled = enabled;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  update(): void {
    this.orbit.update();
    this.cameraHelper.update();
    const selected = this.gizmo.object;
    if (selected) {
      this.selectionBox.setFromObject(selected);
    }
  }

  focusSelected(): void {
    const selected = this.gizmo.object;
    if (!selected) {
      return;
    }
    const box = new THREE.Box3().setFromObject(selected);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.5, box.getSize(new THREE.Vector3()).length() / 2);
    const direction = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, radius * 2.4);
    this.orbit.update();
  }

  private applySelection(uuid: string | null): void {
    const object = uuid ? this.options.root.getObjectByProperty("uuid", uuid) : undefined;
    if (object) {
      this.gizmo.attach(object);
      this.selectionBox.setFromObject(object);
      this.selectionBox.visible = true;
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
    if (!this.enabled || event.button !== 0 || this.gizmo.dragging) {
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
      if (!hit.object.visible) {
        continue;
      }
      const selectable = findSelectable(hit.object, this.options.root);
      if (selectable) {
        selectedUuid.value = selectable.uuid;
        return;
      }
    }
    selectedUuid.value = null;
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || event.target instanceof HTMLInputElement) {
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
