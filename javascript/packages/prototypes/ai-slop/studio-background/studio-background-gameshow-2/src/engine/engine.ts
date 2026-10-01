import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createCameraRig } from "../scene/cameraRig";
import type { CameraRigHandle } from "../scene/cameraRig";
import { createStudio } from "../scene/studio";
import type { StudioHandle } from "../scene/studio";
import { activeTab, fps, isPlaying } from "../state";
import type { ViewTab } from "../state";
import { Editor } from "./editor";

// One renderer and one scene serve both tabs, like Unity's Scene and Game views.
// The canvas moves into the container of the active tab.
class StudioEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly studio: StudioHandle;
  readonly cameraRig: CameraRigHandle;
  readonly editor: Editor;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly containers = new Map<ViewTab, HTMLElement>();
  private readonly resizeObserver: ResizeObserver;
  private readonly timer = new THREE.Timer();
  private view: ViewTab = activeTab.value;
  private time = 0;
  private sizeDirty = true;
  private frameCount = 0;
  private fpsWindowStart = performance.now();

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = "block";

    this.scene.background = new THREE.Color(0x020308);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.05;

    this.studio = createStudio(this.renderer);
    this.scene.add(this.studio.root);

    // A raised three-quarter-high view picked in the Scene view: 44° FOV, eye 5.3 m high, 15.9 m from the wheel,
    // tilted down by 6.3°, so the floor rings, the podium and the ceiling rig all read.
    const eye = new THREE.Vector3(0, 5.3, 15.15);
    const pitchDown = 0.11;
    const target = eye.clone().add(new THREE.Vector3(0, -Math.sin(pitchDown), -Math.cos(pitchDown)).multiplyScalar(15.9));
    this.cameraRig = createCameraRig(eye, target, 44);
    this.studio.root.add(this.cameraRig.rig);

    this.editor = new Editor({
      scene: this.scene,
      root: this.studio.root,
      canvas: this.renderer.domElement,
      mainCamera: this.cameraRig.camera,
    });

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.cameraRig.camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.35, 1.1);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.resizeObserver = new ResizeObserver(() => {
      this.sizeDirty = true;
    });

    activeTab.subscribe((tab) => {
      this.view = tab;
      this.mountCanvas();
    });

    this.timer.connect(document);
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

  // Advances the animation by a fixed step. Used by headless captures.
  step(seconds: number): void {
    this.advance(seconds);
    this.render();
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
    this.renderer.setSize(width, height);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    this.editor.resize(width, height);
    // The main camera keeps the game aspect so the camera gizmo shows the real frame.
    this.cameraRig.camera.aspect = this.view === "game" ? width / height : 16 / 9;
    this.cameraRig.camera.updateProjectionMatrix();
    this.sizeDirty = false;
  }

  private advance(seconds: number): void {
    this.time += seconds;
    this.studio.update(this.time);
    this.cameraRig.update(this.time);
  }

  private render(): void {
    if (this.sizeDirty) {
      this.applySize();
    }
    this.editor.update();
    this.renderPass.camera = this.view === "game" ? this.cameraRig.camera : this.editor.camera;
    this.composer.render();
  }

  private readonly frame = (timestamp: number): void => {
    this.timer.update(timestamp);
    if (isPlaying.value) {
      this.advance(Math.min(this.timer.getDelta(), 0.1));
    }
    this.render();

    this.frameCount += 1;
    const now = performance.now();
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
