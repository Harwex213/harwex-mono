import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { createCameraRig } from "./cameraRig";
import { createCity } from "./city";
import { createLights } from "./lights";
import { createEnvironment, createMaterials } from "./materials";
import { createProps } from "./props";
import { createStudio } from "./studio";
import { createWheel } from "./wheel";

type StageControls = {
  swing: () => boolean;
  dolly: () => boolean;
  spin: () => boolean;
};

declare global {
  interface Window {
    // Capture hook: jumps every animation to `time` seconds and renders one frame.
    __studio?: { seek: (time: number) => void };
  }
}

function createStage(container: HTMLElement, controls: StageControls): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010209);
  scene.environment = createEnvironment(renderer);
  scene.environmentIntensity = 0.8;

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 1000);
  const rig = createCameraRig(camera);

  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  const materials = createMaterials();
  const studio = createStudio(materials, width, height);
  const wheel = createWheel(materials);
  const city = createCity();
  const lights = createLights();
  scene.add(studio.group, wheel.group, city.group, createProps(materials), lights.group);

  // The composer target carries MSAA because the render pass draws into it, not the canvas.
  const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.25, 0.2, 1.2);
  // `?bloom=0` drops the bloom pass: handy to spot a single broken pixel before bloom smears it.
  if (new URLSearchParams(window.location.search).get("bloom") !== "0") {
    composer.addPass(bloom);
  }
  composer.addPass(new OutputPass());

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    studio.reflector.getRenderTarget().setSize(w * 0.5 * renderer.getPixelRatio(), h * 0.5 * renderer.getPixelRatio());
    rig.resize(w / h);
  };
  resize();
  window.addEventListener("resize", resize);

  let time = 0;
  let last = performance.now();
  const step = (dt: number) => {
    time += dt;
    wheel.update(dt, time, controls.spin());
    rig.update(dt, controls.swing(), controls.dolly());
    lights.update(time);
    city.update(renderer, time);
    composer.render(dt);
  };

  // `?t=12` freezes the scene at 12 s, so captures are repeatable.
  // `?still=1` also holds the camera at its start, to compare the motion of the backdrop alone.
  const params = new URLSearchParams(window.location.search);
  const frozen = params.get("t");
  const still = params.get("still") === "1";
  window.__studio = {
    seek: (seconds: number) => {
      time = 0;
      rig.seek(0);
      wheel.update(0, 0, true);
      // Run the wheel in small steps so its spin cycle state stays consistent.
      const steps = Math.ceil(seconds / 0.05);
      for (let i = 0; i < steps; i++) {
        time += seconds / steps;
        wheel.update(seconds / steps, time, true);
      }
      rig.seek(still ? 0 : seconds);
      rig.update(0, true, true);
      lights.update(time);
      city.update(renderer, time);
      composer.render(0);
    },
  };

  if (frozen !== null) {
    window.__studio.seek(Number(frozen));
    // Keep redrawing the frozen frame: the city photo arrives after the first render.
    renderer.setAnimationLoop(() => {
      city.update(renderer, time);
      composer.render(0);
    });
  } else {
    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      step(dt);
    });
  }

  return () => {
    renderer.setAnimationLoop(null);
    window.removeEventListener("resize", resize);
    delete window.__studio;
    composer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

export { createStage };
export type { StageControls };
