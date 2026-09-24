import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * The 3D viewer's world, outside React: a glTF the main process exported from
 * the tab's Blender, lights, a grid, orbit controls, a gizmo on the selected
 * mesh, and the scene's materials as editable numbers. Everything done here is a
 * try-out — the file on disk is never touched — and Reset loads the model
 * again as it came.
 */

type GizmoMode = "translate" | "rotate" | "scale";

/** One material of the scene, however many meshes carry it. */
interface SceneMaterial {
  /** The material's name, or its uuid when it has no name. Identity for patches. */
  key: string;
  name: string;
  color: string;
  metalness: number;
  roughness: number;
  opacity: number;
  wireframe: boolean;
  /** The base colour comes from a texture, so `color` only tints it. */
  textured: boolean;
  /** Every mesh the material is on. */
  meshes: { uuid: string; name: string }[];
}

interface SceneInfo {
  materials: SceneMaterial[];
  selected: string | null;
  /** Name of the selected mesh, which is the Blender object's name. */
  selectedName: string | null;
  /** Every named node of the model, so the object panel knows what it can select. */
  nodeNames: string[];
  meshCount: number;
  loaded: boolean;
  error: string;
}

type MaterialPatch = Partial<Pick<SceneMaterial, "color" | "metalness" | "roughness" | "opacity" | "wireframe">>;

const BACKGROUND = 0x14161f;

function isStandard(material: THREE.Material): material is THREE.MeshStandardMaterial {
  return (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("The viewer could not produce an image."));
      }
    }, "image/png");
  });
}

/** What makes two materials one row in the panel. */
function materialKey(material: THREE.Material): string {
  return material.name.length > 0 ? material.name : material.uuid;
}

/**
 * Whether one node of the model belongs to one Blender object. The glTF
 * exporter writes a node named after the object, and when that object has
 * several materials it writes one numbered child per slot — `Wall` becomes a
 * group `Wall` over `Wall_1`, `Wall_2`. The object panel has the Blender
 * names, the viewer has the node names, and this is what joins them.
 */
function belongsToObject(nodeName: string, objectName: string): boolean {
  if (nodeName === objectName) {
    return true;
  }
  if (!nodeName.startsWith(`${objectName}_`)) {
    return false;
  }
  const slot = nodeName.slice(objectName.length + 1);
  return slot.length > 0 && /^\d+$/.test(slot);
}

/**
 * The node that stands for a Blender object, given something the ray hit.
 * A hit on one material slot selects the whole object, the way clicking in
 * Blender does.
 */
function objectNodeOf(hit: THREE.Object3D): THREE.Object3D {
  const parent = hit.parent;
  if (parent && parent.name.length > 0 && belongsToObject(hit.name, parent.name) && hit.name !== parent.name) {
    return parent;
  }
  return hit;
}

class ModelViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly orbit: OrbitControls;
  private readonly gizmo: TransformControls;
  private readonly loader = new GLTFLoader();
  private readonly raycaster = new THREE.Raycaster();
  private readonly highlight = new THREE.BoxHelper(new THREE.Object3D(), 0xffc857);
  private readonly onChange: (info: SceneInfo) => void;
  private readonly onResize: () => void;
  private model: THREE.Group | null = null;
  private selected: THREE.Object3D | null = null;
  private lastUrl = "";
  private loadCount = 0;
  private lastBounds: THREE.Sphere | null = null;
  private frame = 0;
  private pressed: { x: number; y: number } | null = null;
  private error = "";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    onChange: (info: SceneInfo) => void,
  ) {
    this.onChange = onChange;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.scene.background = new THREE.Color(BACKGROUND);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
    this.camera.position.set(3, 2.2, 3.4);

    const hemi = new THREE.HemisphereLight(0xdfe6ff, 0x2a2622, 0.5);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 6, 3);
    this.scene.add(hemi, key);
    const grid = new THREE.GridHelper(20, 40, 0x3a3f55, 0x262a3a);
    grid.position.y = -0.001;
    this.scene.add(grid);

    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.screenSpacePanning = true;
    this.orbit.minDistance = 0.05;
    this.orbit.maxDistance = 200;

    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.addEventListener("dragging-changed", (event) => {
      this.orbit.enabled = !(event as unknown as { value: boolean }).value;
    });
    this.scene.add(this.gizmo.getHelper());

    this.highlight.visible = false;
    this.scene.add(this.highlight);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    this.onResize = () => {
      this.resize();
    };
    window.addEventListener("resize", this.onResize);
    this.resize();
    this.tick();
  }

  // ---------------------------------------------------------------------------
  // Loading.

  async load(url: string): Promise<void> {
    this.lastUrl = url;
    this.loadCount += 1;
    const count = this.loadCount;
    let gltf: Awaited<ReturnType<GLTFLoader["loadAsync"]>>;
    try {
      gltf = await this.loader.loadAsync(url);
    } catch (error) {
      if (count === this.loadCount) {
        this.error = error instanceof Error ? error.message : String(error);
        this.emit();
      }
      return;
    }
    if (count !== this.loadCount) {
      return;
    }
    this.error = "";
    this.replaceModel(gltf.scene);
  }

  /** Puts the model back the way the file had it. Camera stays where it is. */
  async reset(): Promise<void> {
    if (this.lastUrl.length > 0) {
      await this.load(this.lastUrl);
    }
  }

  private replaceModel(next: THREE.Group): void {
    const previousSelection = this.selected?.name ?? null;
    this.select(null);
    if (this.model) {
      this.scene.remove(this.model);
      this.disposeTree(this.model);
    }
    this.model = next;
    this.model.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });
    this.scene.add(this.model);

    const bounds = new THREE.Box3().setFromObject(this.model);
    const sphere = bounds.isEmpty() ? null : bounds.getBoundingSphere(new THREE.Sphere());
    const moved =
      sphere !== null &&
      (this.lastBounds === null ||
        sphere.radius > this.lastBounds.radius * 2 ||
        sphere.radius < this.lastBounds.radius / 2 ||
        sphere.center.distanceTo(this.lastBounds.center) > this.lastBounds.radius);
    if (moved) {
      this.frameBounds(sphere);
    }
    this.lastBounds = sphere;

    if (previousSelection) {
      let again: THREE.Object3D | null = null;
      this.model.traverse((object) => {
        if (!again && object.name === previousSelection) {
          again = object;
        }
      });
      this.select(again);
    }
    this.emit();
  }

  private disposeTree(root: THREE.Object3D): void {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      mesh.geometry.dispose();
      for (const material of materialsOf(mesh)) {
        for (const value of Object.values(material)) {
          if ((value as THREE.Texture)?.isTexture) {
            (value as THREE.Texture).dispose();
          }
        }
        material.dispose();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Camera.

  frameModel(): void {
    if (!this.model) {
      return;
    }
    const bounds = new THREE.Box3().setFromObject(this.model);
    if (!bounds.isEmpty()) {
      this.frameBounds(bounds.getBoundingSphere(new THREE.Sphere()));
    }
  }

  /** Brings the selected mesh into view without changing how far the camera is. */
  private frameSelection(): void {
    if (!this.selected) {
      return;
    }
    const bounds = new THREE.Box3().setFromObject(this.selected);
    if (bounds.isEmpty()) {
      return;
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const offset = this.camera.position.clone().sub(this.orbit.target);
    this.orbit.target.copy(center);
    this.camera.position.copy(center).add(offset);
    this.orbit.update();
  }

  private frameBounds(sphere: THREE.Sphere): void {
    const radius = Math.max(sphere.radius, 0.05);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const direction = new THREE.Vector3(0.9, 0.6, 1).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(direction, distance * 1.15);
    this.camera.near = Math.max(distance / 500, 0.001);
    this.camera.far = distance * 20 + radius * 4;
    this.camera.updateProjectionMatrix();
    this.orbit.target.copy(sphere.center);
    this.orbit.update();
  }

  // ---------------------------------------------------------------------------
  // Selection and the gizmo.

  private readonly onPointerDown = (event: PointerEvent) => {
    this.pressed = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const pressed = this.pressed;
    this.pressed = null;
    if (!pressed || event.button !== 0 || this.gizmo.dragging) {
      return;
    }
    if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 4) {
      return;
    }
    if (!this.model) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const point = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(point, this.camera);
    const hit = this.raycaster.intersectObject(this.model, true).find((entry) => (entry.object as THREE.Mesh).isMesh);
    this.select(hit ? objectNodeOf(hit.object) : null);
    this.emit();
  };

  select(node: THREE.Object3D | null): void {
    this.selected = node;
    if (node) {
      this.gizmo.attach(node);
      this.highlight.setFromObject(node);
      this.highlight.visible = true;
    } else {
      this.gizmo.detach();
      this.highlight.visible = false;
    }
  }

  /**
   * Selects the node named after one Blender object, which is what the object
   * panel has. Lights, cameras and empties are in Blender's outliner but the
   * export leaves the first two out, so a name the model does not carry
   * selects nothing.
   */
  selectByName(name: string | null): void {
    if (!name || !this.model) {
      this.select(null);
      this.emit();
      return;
    }
    let found: THREE.Object3D | null = null;
    this.model.traverse((object) => {
      if (!found && object.name === name) {
        found = object;
      }
    });
    this.select(found);
    if (found) {
      this.frameSelection();
    }
    this.emit();
  }

  selectByUuid(uuid: string | null): void {
    if (!uuid || !this.model) {
      this.select(null);
      this.emit();
      return;
    }
    let found: THREE.Object3D | null = null;
    this.model.traverse((object) => {
      if (!found && object.uuid === uuid) {
        found = object;
      }
    });
    this.select(found);
    this.emit();
  }

  setMode(mode: GizmoMode): void {
    this.gizmo.setMode(mode);
  }

  // ---------------------------------------------------------------------------
  // Materials.

  /**
   * The scene's materials, one entry each, in the order they are first met.
   * Meshes that share a material share its entry, so five materials on fifty
   * meshes are five rows.
   *
   * The name is the identity, because the glTF loader can build a material
   * more than once — once per set of mesh flags it needs — and those copies are
   * one material to everyone but the loader.
   */
  private materialList(): SceneMaterial[] {
    const list: SceneMaterial[] = [];
    const byKey = new Map<string, SceneMaterial>();
    if (!this.model) {
      return list;
    }
    this.model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      for (const material of materialsOf(mesh)) {
        const key = materialKey(material);
        let entry = byKey.get(key);
        if (!entry) {
          const standard = isStandard(material) ? material : null;
          entry = {
            key,
            name: material.name || "material",
            color: standard ? `#${standard.color.getHexString()}` : "#888888",
            metalness: standard ? standard.metalness : 0,
            roughness: standard ? standard.roughness : 1,
            opacity: material.opacity,
            wireframe: standard ? standard.wireframe : false,
            textured: standard?.map != null,
            meshes: [],
          };
          byKey.set(key, entry);
          list.push(entry);
        }
        if (!entry.meshes.some((entryMesh) => entryMesh.uuid === mesh.uuid)) {
          entry.meshes.push({ uuid: mesh.uuid, name: mesh.name || "mesh" });
        }
      }
    });
    return list;
  }

  /** Applies the patch to every copy of one material, wherever it sits. */
  patchMaterial(key: string, patch: MaterialPatch): void {
    if (!this.model) {
      return;
    }
    const done = new Set<string>();
    this.model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      for (const material of materialsOf(mesh)) {
        if (materialKey(material) !== key || done.has(material.uuid)) {
          continue;
        }
        done.add(material.uuid);
        if (patch.opacity !== undefined) {
          material.opacity = patch.opacity;
          material.transparent = patch.opacity < 1;
          material.needsUpdate = true;
        }
        if (isStandard(material)) {
          if (patch.color !== undefined) {
            material.color.set(patch.color);
          }
          if (patch.metalness !== undefined) {
            material.metalness = patch.metalness;
          }
          if (patch.roughness !== undefined) {
            material.roughness = patch.roughness;
          }
          if (patch.wireframe !== undefined) {
            material.wireframe = patch.wireframe;
          }
        }
      }
    });
    this.emit();
  }

  // ---------------------------------------------------------------------------
  // Frame loop, output, teardown.

  private emit(): void {
    const nodeNames: string[] = [];
    let meshCount = 0;
    this.model?.traverse((object) => {
      if (object.name.length > 0) {
        nodeNames.push(object.name);
      }
      if ((object as THREE.Mesh).isMesh) {
        meshCount += 1;
      }
    });
    this.onChange({
      materials: this.materialList(),
      selected: this.selected?.uuid ?? null,
      selectedName: this.selected?.name ?? null,
      nodeNames,
      meshCount,
      loaded: this.model !== null,
      error: this.error,
    });
  }

  resize(): void {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private readonly tick = () => {
    this.frame = requestAnimationFrame(this.tick);
    this.orbit.update();
    if (this.selected) {
      this.highlight.setFromObject(this.selected);
    }
    this.renderer.render(this.scene, this.camera);
  };

  /** The canvas as it looks right now, as a PNG. */
  screenshot(): Promise<Blob> {
    this.renderer.render(this.scene, this.camera);
    return toBlob(this.canvas);
  }

  /**
   * One rectangle of the canvas, as a PNG. The rectangle is in CSS pixels
   * relative to the canvas, the way the pointer reports them, and it is scaled
   * to the drawing buffer and clamped to it here.
   *
   * The frame is drawn again right before the copy: the drawing buffer is not
   * preserved, so anything read later in the task is empty.
   */
  screenshotRegion(rect: { x: number; y: number; width: number; height: number }): Promise<Blob> {
    const scaleX = this.canvas.width / (this.canvas.clientWidth || 1);
    const scaleY = this.canvas.height / (this.canvas.clientHeight || 1);
    const x = Math.min(Math.max(Math.round(rect.x * scaleX), 0), this.canvas.width);
    const y = Math.min(Math.max(Math.round(rect.y * scaleY), 0), this.canvas.height);
    const width = Math.min(Math.round(rect.width * scaleX), this.canvas.width - x);
    const height = Math.min(Math.round(rect.height * scaleY), this.canvas.height - y);
    if (width < 1 || height < 1) {
      return Promise.reject(new Error("The region is too small to capture."));
    }
    const crop = document.createElement("canvas");
    crop.width = width;
    crop.height = height;
    const context = crop.getContext("2d");
    if (!context) {
      return Promise.reject(new Error("The viewer could not crop the image."));
    }
    this.renderer.render(this.scene, this.camera);
    context.drawImage(this.canvas, x, y, width, height, 0, 0, width, height);
    return toBlob(crop);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("resize", this.onResize);
    this.gizmo.dispose();
    this.orbit.dispose();
    if (this.model) {
      this.disposeTree(this.model);
    }
    this.renderer.dispose();
  }
}

export type { GizmoMode, MaterialPatch, SceneInfo, SceneMaterial };
export { belongsToObject, ModelViewer };
