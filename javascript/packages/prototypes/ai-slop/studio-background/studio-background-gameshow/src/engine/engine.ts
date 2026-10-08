import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { createCameraRig } from "../scene/cameraRig";
import { createCity } from "../scene/city";
import { named } from "../scene/geometry";
import { createLights } from "../scene/lights";
import { createEnvironment, createMaterials } from "../scene/materials";
import { annexFloorPlan, createAnnex } from "../scene/annex";
import { createBuffet } from "../scene/buffet";
import { createCasinoBackdrop } from "../scene/casinoBackdrop";
import { createDressing } from "../scene/dressing";
import { createGameMaterials, createGameProps } from "../scene/gameProps";
import { createProps } from "../scene/props";
import { createSofas } from "../scene/sofas";
import { createStudio } from "../scene/studio";
import { createWheel } from "../scene/wheel";
import { activeTab, dolly, fps, isPlaying, params, renderMode, shot, spin, swing } from "../state";
import type { ViewTab } from "../state";
import { Editor } from "./editor";
import { EditorLighting } from "./editorLighting";
import { LightZones } from "./lightZones";
import { recenterPivots } from "./pivots";
import { SceneDocument } from "./sceneDocument";

const GAME_ASPECT = 16 / 9;

// One renderer and one scene serve both tabs, like Unity's Scene and Game views.
// The canvas moves into the container of the active tab.
class StudioEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly root = named(new THREE.Group(), "Game Show Studio", true);
  readonly camera = named(new THREE.PerspectiveCamera(40, GAME_ASPECT, 0.1, 1000), "Main Camera");
  readonly editor: Editor;
  readonly document: SceneDocument;
  private readonly rig: ReturnType<typeof createCameraRig>;
  private readonly wheel: ReturnType<typeof createWheel>;
  private readonly lights: ReturnType<typeof createLights>;
  private readonly city: ReturnType<typeof createCity>;
  private readonly annex: ReturnType<typeof createAnnex>;
  private readonly reflector: Reflector;
  private readonly lighting: EditorLighting;
  private readonly zones: LightZones;
  private readonly bloom: UnrealBloomPass | null = null;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly containers = new Map<ViewTab, HTMLElement>();
  private readonly resizeObserver: ResizeObserver;
  private view: ViewTab = activeTab.value;
  private time = 0;
  private last = performance.now();
  private sizeDirty = true;
  private frameCount = 0;
  private fpsWindowStart = performance.now();

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = "block";

    this.scene.background = new THREE.Color(0x010209);
    this.scene.environment = createEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.8;

    this.rig = createCameraRig(this.camera, shot.value);
    // The camera is animated by the rig, so its transform is not saved.
    this.camera.userData.animated = true;

    const materials = createMaterials();
    const gameMaterials = createGameMaterials();
    // The real size comes with the first layout; the reflector target is resized then.
    const studio = createStudio(materials, 1280, 720, annexFloorPlan());
    this.reflector = studio.reflector;
    this.wheel = createWheel(materials);
    this.city = createCity();
    this.lights = createLights();
    // The casino backdrop behind the partition opening (annex.ts places it); `annex.update` drives its animation.
    this.annex = createAnnex(materials, createCasinoBackdrop());
    this.root.add(this.camera, studio.group, this.wheel.group, createProps(materials), createDressing(materials), createSofas(materials), createBuffet(materials), createGameProps(gameMaterials), this.annex.group, this.lights.group, this.city.group);
    this.scene.add(this.root);

    // Place everything at time 0 before the snapshot of code defaults.
    this.wheel.update(0, 0, true);
    this.rig.update(0, true, true);
    this.lights.update(0);
    this.annex.update(0);
    // Every selectable object gets its origin on itself, so the gizmo appears where the object is.
    recenterPivots(this.root);
    this.document = new SceneDocument(this.root);
    const floor = studio.group.getObjectByName("Marble") as THREE.Mesh;
    // The annex part of the floor gets the environment as its own map: only an own map obeys `envMapIntensity` (studio.ts).
    const annexMarble = (floor.material as THREE.MeshStandardMaterial[])[1];
    if (annexMarble) {
      annexMarble.envMap = this.scene.environment;
    }
    this.lighting = new EditorLighting(this.renderer, this.scene, this.root, this.reflector, floor);
    this.zones = new LightZones(this.root);

    this.editor = new Editor({
      scene: this.scene,
      root: this.root,
      canvas: this.renderer.domElement,
      mainCamera: this.camera,
      save: () => {
        void this.document.save();
      },
      checkpoint: () => {
        this.document.checkpoint();
      },
      undo: () => {
        this.document.undo();
      },
      redo: () => {
        this.document.redo();
      },
    });

    // The composer target carries MSAA because the render pass draws into it, not the canvas.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    // `?bloom=0` drops the bloom pass: handy to spot a single broken pixel before bloom smears it.
    if (params.get("bloom") !== "0") {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.25, 0.2, 1.2);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.scene.updateMatrixWorld();
    this.zones.warmUp(this.renderer, this.scene, this.camera, target);

    this.resizeObserver = new ResizeObserver(() => {
      this.sizeDirty = true;
    });

    // A new shot makes the camera travel to it; the first call (the current shot) changes nothing.
    shot.subscribe((value) => {
      this.rig.travelTo(value);
    });

    activeTab.subscribe((tab) => {
      this.view = tab;
      this.mountCanvas();
    });

    // `?t=12` freezes the scene at 12 s, so captures are repeatable.
    const frozen = params.get("t");
    if (frozen !== null) {
      this.seek(Number(frozen));
      isPlaying.value = false;
    }
    this.renderer.setAnimationLoop(this.frame);
  }

  attach(tab: ViewTab, element: HTMLElement): void {
    this.containers.set(tab, element);
    this.resizeObserver.observe(element);
    this.mountCanvas();
  }

  detach(tab: ViewTab): void {
    const element = this.containers.get(tab);
    if (element) {
      this.resizeObserver.unobserve(element);
    }
    this.containers.delete(tab);
  }

  // Capture hook: jumps every animation to `seconds` and renders one frame.
  // `?still=1` holds the camera at its start, to compare the motion of the backdrop alone.
  seek(seconds: number): void {
    this.time = 0;
    this.rig.seek(0);
    this.wheel.update(0, 0, true);
    // Run the wheel in small steps so its spin cycle state stays consistent.
    const steps = Math.ceil(seconds / 0.05);
    for (let i = 0; i < steps; i++) {
      this.time += seconds / steps;
      this.wheel.update(seconds / steps, this.time, true);
    }
    this.rig.seek(params.get("still") === "1" ? 0 : seconds);
    this.rig.update(0, true, true);
    this.lights.update(this.time);
    this.annex.update(this.time);
    this.render(0);
  }

  private mountCanvas(): void {
    const container = this.containers.get(this.view);
    if (!container) {
      return;
    }
    if (this.renderer.domElement.parentElement !== container) {
      container.appendChild(this.renderer.domElement);
    }
    this.editor.setEnabled(this.view === "scene");
    this.sizeDirty = true;
  }

  private applySize(): void {
    const container = this.containers.get(this.view);
    if (!container) {
      return;
    }
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const ratio = this.renderer.getPixelRatio();
    this.renderer.setSize(width, height);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.reflector.getRenderTarget().setSize(width * 0.5 * ratio, height * 0.5 * ratio);
    this.editor.resize(width, height);
    // In the Scene view the main camera keeps the game aspect, so the camera gizmo shows the real frame.
    this.rig.resize(this.view === "game" ? width / height : GAME_ASPECT);
    this.sizeDirty = false;
  }

  private advance(dt: number): void {
    this.time += dt;
    this.wheel.update(dt, this.time, spin.value);
    // A paused rig leaves the camera alone, so a camera moved in the editor stays where it is.
    // A move to another shot runs to its end anyway.
    if (swing.value || dolly.value || this.rig.isTraveling()) {
      this.rig.update(dt, swing.value, dolly.value);
    }
    this.lights.update(this.time);
    this.annex.update(this.time);
  }

  private render(dt: number): void {
    if (this.sizeDirty) {
      this.applySize();
    }
    this.editor.update(dt);
    // The city photo arrives after the first frames, so its lights are redrawn even while paused.
    this.city.update(this.renderer, this.time);
    this.renderPass.camera = this.view === "game" ? this.camera : this.editor.camera;
    const editorLit = this.view === "scene" && renderMode.value === "editor";
    // The lights of a room out of view are left out of this frame.
    this.zones.update(this.renderPass.camera, editorLit);
    if (this.bloom) {
      this.bloom.enabled = !editorLit;
    }
    if (editorLit) {
      this.lighting.begin();
    }
    this.composer.render();
    this.lighting.end();
  }

  private readonly frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (isPlaying.value) {
      this.advance(dt);
    } else if (this.rig.isTraveling()) {
      // A shot picked while paused still gets its camera move.
      this.rig.update(dt, false, false);
    }
    this.render(dt);

    this.frameCount += 1;
    if (now - this.fpsWindowStart > 500) {
      fps.value = Math.round((this.frameCount * 1000) / (now - this.fpsWindowStart));
      this.frameCount = 0;
      this.fpsWindowStart = now;
    }
  };
}

let instance: StudioEngine | null = null;

function getEngine(): StudioEngine {
  if (!instance) {
    instance = new StudioEngine();
  }
  return instance;
}

export { StudioEngine, getEngine };
