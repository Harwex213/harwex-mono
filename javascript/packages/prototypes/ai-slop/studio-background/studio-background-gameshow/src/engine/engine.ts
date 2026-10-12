import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { BODIES, COMPONENTS } from "../scene/components";
import type { RigBehaviour } from "../scene/components";
import type { CameraRig } from "../scene/cameraRig";
import { named } from "../scene/geometry";
import { MaterialLibrary } from "../scene/materialLibrary";
import { createEnvironment } from "../scene/materials";
import { activeTab, dolly, fps, isPlaying, params, renderMode, selectedUuid, shot, spin, swing } from "../state";
import type { ViewTab } from "../state";
import { Editor } from "./editor";
import { EditorLighting } from "./editorLighting";
import type { AddKind } from "./primitives";
import { isLightKind } from "./primitives";
import { LightZones } from "./lightZones";
import { SceneDocument } from "./sceneDocument";
import type { ExternalChange } from "./sceneDocument";
import { decodeColor } from "./sceneFormat";
import type { SceneSettings } from "./sceneFormat";
import type { Behaviour } from "./sceneLoader";
import { SceneSync } from "./sceneSync";
import type { OpenedScene } from "./sceneSync";

const GAME_ASPECT = 16 / 9;

// The names of the render settings in the scene file.
const TONE_MAPPINGS: Record<string, THREE.ToneMapping> = {
  None: THREE.NoToneMapping,
  Linear: THREE.LinearToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
  Cineon: THREE.CineonToneMapping,
  ACESFilmic: THREE.ACESFilmicToneMapping,
  AgX: THREE.AgXToneMapping,
  Neutral: THREE.NeutralToneMapping,
};

const SHADOW_MAPS: Record<string, THREE.ShadowMapType> = {
  Basic: THREE.BasicShadowMap,
  PCF: THREE.PCFShadowMap,
  PCFSoft: THREE.PCFSoftShadowMap,
  VSM: THREE.VSMShadowMap,
};

// One renderer and one scene serve both tabs, like Unity's Scene and Game views.
// The canvas moves into the container of the active tab.
class StudioEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  // The scene root. Everything under it comes from the open version of the scene file (src/scene/versions/).
  readonly root = named(new THREE.Group(), "Game Show Studio", true);
  readonly camera: THREE.PerspectiveCamera;
  readonly editor: Editor;
  readonly document: SceneDocument;
  readonly sync: SceneSync;
  readonly library: MaterialLibrary;
  private rig: CameraRig;
  // The live list of the document: an external change starts and stops behaviours in it.
  private readonly behaviours: Behaviour[];
  private readonly reflectors: Reflector[] = [];
  private readonly lighting: EditorLighting;
  private readonly zones: LightZones;
  private bloom: UnrealBloomPass | null = null;
  private studioEnvironment: THREE.Texture | null = null;
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

  constructor(opened: OpenedScene) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.display = "block";

    this.library = new MaterialLibrary(this.renderer);
    this.document = new SceneDocument(this.root, this.library, COMPONENTS, BODIES, opened.file);
    this.sync = new SceneSync(this.document, opened);
    // The render settings of the scene file.
    const settings = this.document.settings;
    this.applySettings(settings);
    this.scene.add(this.root);
    this.behaviours = this.document.behaviours;
    this.rig = this.findRig();
    let camera: THREE.PerspectiveCamera | null = null;
    let floor: THREE.Mesh | null = null;
    this.root.traverse((object) => {
      if ((object as THREE.PerspectiveCamera).isPerspectiveCamera && !camera) {
        camera = object as THREE.PerspectiveCamera;
      }
      if ((object as Reflector).isReflector) {
        this.reflectors.push(object as Reflector);
      }
      if (object.userData.editorMatte && (object as THREE.Mesh).isMesh && !floor) {
        floor = object as THREE.Mesh;
      }
    });
    if (!camera || !floor) {
      throw new Error("[scene] the scene file needs a camera and a floor with the editorMatte flag");
    }
    this.camera = camera;

    // Place everything at time 0.
    this.stepAll(0, 0, true);
    this.rig.update(0, true, true);
    this.updateAll(0);
    this.beforeRender(0);
    this.lighting = new EditorLighting(this.renderer, this.scene, this.root, this.reflectors, floor);
    this.zones = new LightZones(this.root);

    this.editor = new Editor({
      scene: this.scene,
      root: this.root,
      canvas: this.renderer.domElement,
      mainCamera: this.camera,
      save: () => {
        void this.sync.save();
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
      remove: () => {
        const uuid = selectedUuid.value;
        const object = uuid ? this.root.getObjectByProperty("uuid", uuid) : undefined;
        if (object) {
          this.document.remove(object);
        }
      },
    });

    // The composer target carries MSAA because the render pass draws into it, not the canvas.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: settings.samples });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    // `?bloom=0` drops the bloom pass: handy to spot a single broken pixel before bloom smears it.
    if (settings.bloom && params.get("bloom") !== "0") {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), settings.bloom.strength, settings.bloom.radius, settings.bloom.threshold);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.scene.updateMatrixWorld();
    this.zones.warmUp(this.renderer, this.scene, this.camera, target);
    this.document.onExternalChange = (change) => {
      this.followChange(change);
    };

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

  private findRig(): CameraRig {
    const rig = this.behaviours.find((behaviour): behaviour is RigBehaviour => "rig" in behaviour);
    if (!rig) {
      throw new Error("[scene] no object has a cameraRig component");
    }
    return rig.rig;
  }

  // The render settings of the scene file. A change of the shadow map type compiles the materials again.
  private applySettings(settings: SceneSettings): void {
    const renderer = this.renderer;
    renderer.toneMapping = TONE_MAPPINGS[settings.toneMapping] ?? THREE.NoToneMapping;
    renderer.toneMappingExposure = settings.toneMappingExposure;
    const shadows = settings.shadowMap !== "None";
    const shadowType = SHADOW_MAPS[settings.shadowMap] ?? THREE.PCFShadowMap;
    if (renderer.shadowMap.enabled !== shadows || renderer.shadowMap.type !== shadowType) {
      renderer.shadowMap.enabled = shadows;
      renderer.shadowMap.type = shadowType;
      renderer.shadowMap.needsUpdate = true;
      this.scene.traverse((object) => {
        const material = (object as THREE.Mesh).material;
        for (const item of Array.isArray(material) ? material : material ? [material] : []) {
          item.needsUpdate = true;
        }
      });
    }
    this.scene.background = decodeColor(settings.background, new THREE.Color());
    if (settings.environment === "casino") {
      this.scene.environment = this.library.casinoEnvironment;
    } else {
      this.studioEnvironment ??= createEnvironment(renderer);
      this.scene.environment = this.studioEnvironment;
    }
    this.scene.environmentIntensity = settings.environmentIntensity;
  }

  // Follows a change of the scene file on disk (SceneDocument.applyFile): render settings, post-processing,
  // a camera rig or mirror that started again.
  private followChange(change: ExternalChange): void {
    if (change.settings) {
      const settings = this.document.settings;
      this.applySettings(settings);
      for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
        if (target.samples !== settings.samples) {
          target.samples = settings.samples;
          target.dispose();
        }
      }
      const wantsBloom = settings.bloom !== null && params.get("bloom") !== "0";
      if (wantsBloom && settings.bloom) {
        if (!this.bloom) {
          this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), settings.bloom.strength, settings.bloom.radius, settings.bloom.threshold);
          this.composer.insertPass(this.bloom, 1);
        }
        this.bloom.strength = settings.bloom.strength;
        this.bloom.radius = settings.bloom.radius;
        this.bloom.threshold = settings.bloom.threshold;
      } else if (this.bloom) {
        this.composer.removePass(this.bloom);
        this.bloom.dispose();
        this.bloom = null;
      }
    }
    if (change.behaviours) {
      const rig = this.findRig();
      if (rig !== this.rig) {
        this.rig = rig;
        this.rig.seek(this.time);
        this.rig.update(0, true, true);
      }
      this.updateAll(this.time);
    }
    this.reflectors.length = 0;
    this.root.traverse((object) => {
      if ((object as Reflector).isReflector) {
        this.reflectors.push(object as Reflector);
      }
    });
    this.sizeDirty = true;
  }

  // Adds an object of `kind` under `parent`, at the point of the set in the middle of the Scene view.
  // A light goes 3 m above that point.
  add(kind: AddKind, parent: THREE.Object3D): THREE.Object3D | null {
    const at = this.editor.spawnPoint();
    if (isLightKind(kind)) {
      at.y += 3;
    }
    return this.document.add(kind, parent, at);
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
    this.stepAll(0, 0, true);
    // Step in small steps so the state of a stepped component (the wheel spin cycle) stays consistent.
    const steps = Math.ceil(seconds / 0.05);
    for (let i = 0; i < steps; i++) {
      this.time += seconds / steps;
      this.stepAll(seconds / steps, this.time, true);
    }
    this.rig.seek(params.get("still") === "1" ? 0 : seconds);
    this.rig.update(0, true, true);
    this.updateAll(this.time);
    this.render(0);
  }

  private stepAll(dt: number, time: number, spinning: boolean): void {
    for (const behaviour of this.behaviours) {
      behaviour.step?.(dt, time, spinning);
    }
  }

  private updateAll(time: number): void {
    for (const behaviour of this.behaviours) {
      behaviour.update?.(time);
    }
  }

  private beforeRender(time: number): void {
    for (const behaviour of this.behaviours) {
      behaviour.beforeRender?.(this.renderer, time);
    }
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
    for (const reflector of this.reflectors) {
      const scale = (reflector.userData.textureScale as number | undefined) ?? 0.5;
      reflector.getRenderTarget().setSize(width * scale * ratio, height * scale * ratio);
    }
    this.editor.resize(width, height);
    // In the Scene view the main camera keeps the game aspect, so the camera gizmo shows the real frame.
    this.rig.resize(this.view === "game" ? width / height : GAME_ASPECT);
    this.sizeDirty = false;
  }

  private advance(dt: number): void {
    this.time += dt;
    this.stepAll(dt, this.time, spin.value);
    // A paused rig leaves the camera alone, so a camera moved in the editor stays where it is.
    // A move to another shot runs to its end anyway.
    if (swing.value || dolly.value || this.rig.isTraveling()) {
      this.rig.update(dt, swing.value, dolly.value);
    }
    this.updateAll(this.time);
  }

  private render(dt: number): void {
    if (this.sizeDirty) {
      this.applySize();
    }
    this.editor.update(dt);
    // Components that run on every render, also while paused: the city lights (the photo arrives after the first
    // frames) and the lights that follow Bonus Show (a wheel moved in the editor is lit at once).
    this.beforeRender(this.time);
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

// Creates the engine for the opened version (main.tsx, once).
function createEngine(opened: OpenedScene): StudioEngine {
  instance = new StudioEngine(opened);
  // Only `yarn dev` has the scene endpoints; a build opens the version read-only.
  if (import.meta.webpackHot) {
    instance.sync.connect();
  }
  return instance;
}

function getEngine(): StudioEngine {
  if (!instance) {
    throw new Error("[scene] the engine starts after the scene file loads (main.tsx)");
  }
  return instance;
}

export { StudioEngine, createEngine, getEngine };
