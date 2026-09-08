import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * The 3D viewer's world, outside React: a glTF the main process exported from
 * the tab's Blender, lights, a grid, orbit controls, a gizmo on the selected
 * mesh, and the material slots as editable numbers. Everything done here is a
 * try-out — the file on disk is never touched — and Reset loads the model
 * again as it came.
 */

type GizmoMode = "translate" | "rotate" | "scale";

interface MaterialSlot {
  /** `<mesh uuid>:<slot index>`. */
  key: string;
  meshUuid: string;
  meshName: string;
  index: number;
  materialName: string;
  color: string;
  metalness: number;
  roughness: number;
  opacity: number;
  wireframe: boolean;
}

interface SceneInfo {
  slots: MaterialSlot[];
  selected: string | null;
  meshCount: number;
  loaded: boolean;
  error: string;
}

type SlotPatch = Partial<Pick<MaterialSlot, "color" | "metalness" | "roughness" | "opacity" | "wireframe">>;

const BACKGROUND = 0x14161f;

function isStandard(material: THREE.Material): material is THREE.MeshStandardMaterial {
  return (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
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
  private selected: THREE.Mesh | null = null;
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
      let again: THREE.Mesh | null = null;
      this.model.traverse((object) => {
        if (!again && (object as THREE.Mesh).isMesh && object.name === previousSelection) {
          again = object as THREE.Mesh;
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
    this.select(hit ? (hit.object as THREE.Mesh) : null);
    this.emit();
  };

  select(mesh: THREE.Mesh | null): void {
    this.selected = mesh;
    if (mesh) {
      this.gizmo.attach(mesh);
      this.highlight.setFromObject(mesh);
      this.highlight.visible = true;
    } else {
      this.gizmo.detach();
      this.highlight.visible = false;
    }
  }

  selectByUuid(uuid: string | null): void {
    if (!uuid || !this.model) {
      this.select(null);
      this.emit();
      return;
    }
    let found: THREE.Mesh | null = null;
    this.model.traverse((object) => {
      if (!found && object.uuid === uuid && (object as THREE.Mesh).isMesh) {
        found = object as THREE.Mesh;
      }
    });
    this.select(found);
    this.emit();
  }

  setMode(mode: GizmoMode): void {
    this.gizmo.setMode(mode);
  }

  // ---------------------------------------------------------------------------
  // Material slots.

  private slots(): MaterialSlot[] {
    const slots: MaterialSlot[] = [];
    if (!this.model) {
      return slots;
    }
    this.model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      materialsOf(mesh).forEach((material, index) => {
        const standard = isStandard(material) ? material : null;
        slots.push({
          key: `${mesh.uuid}:${index}`,
          meshUuid: mesh.uuid,
          meshName: mesh.name || "mesh",
          index,
          materialName: material.name || `material ${index + 1}`,
          color: standard ? `#${standard.color.getHexString()}` : "#888888",
          metalness: standard ? standard.metalness : 0,
          roughness: standard ? standard.roughness : 1,
          opacity: material.opacity,
          wireframe: standard ? standard.wireframe : false,
        });
      });
    });
    return slots;
  }

  patchSlot(key: string, patch: SlotPatch): void {
    const [uuid, indexText] = key.split(":");
    const index = Number(indexText);
    if (!this.model) {
      return;
    }
    this.model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || mesh.uuid !== uuid) {
        return;
      }
      const material = materialsOf(mesh)[index];
      if (!material) {
        return;
      }
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
    });
    this.emit();
  }

  // ---------------------------------------------------------------------------
  // Frame loop, output, teardown.

  private emit(): void {
    let meshCount = 0;
    this.model?.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        meshCount += 1;
      }
    });
    this.onChange({
      slots: this.slots(),
      selected: this.selected?.uuid ?? null,
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
    return new Promise((resolve, reject) => {
      this.canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("The viewer could not produce an image."));
        }
      }, "image/png");
    });
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

export type { GizmoMode, MaterialSlot, SceneInfo, SlotPatch };
export { ModelViewer };
