import * as THREE from "three";
import { createRng, hashSeed } from "../../core/rng";
import { createGlobeAtlas } from "./globe-atlas";
import { buildGlobeGeometry } from "./globe-geometry";
import { GLOBE_FRAGMENT, GLOBE_VERTEX, MAX_OWNERS, STARS_FRAGMENT, STARS_VERTEX } from "./globe-shaders";
import type { TWorld } from "../../core/world-gen";

/**
 * The three.js side of the globe: one merged mesh of hand-drawn cells, a
 * muted starfield and surface markers. The camera orbits the planet with damping.
 * A click is a ray against the unit sphere, mapped to the nearest cell centre.
 */

/** A crisp drawing does not need more; it keeps weak GPUs at 60 fps. */
const MAX_PIXEL_RATIO = 1.5;
const CAMERA_MIN_DISTANCE = 1.55;
const CAMERA_MAX_DISTANCE = 5;
const CAMERA_START_DISTANCE = 2.9;
const PITCH_LIMIT = 1.3;
/** Radians of turn per pixel of drag at the start distance. */
const DRAG_SPEED = 0.0042;
const DRAG_SLOP_PX = 5;
/** Per second: how fast the view catches up with where it is headed. */
const DAMPING = 9;
/** Per second: how fast a flung globe stops spinning. */
const INERTIA_DECAY = 3.5;
const WHEEL_ZOOM = 0.0012;
const STAR_COUNT = 2600;
const MARKER_LIFT = 1.012;
const BADGE_SIZE = 128;

type TGlobeMarker = {
  readonly key: string;
  readonly cellIndex: number;
  /** URL of the icon drawn inside the badge. */
  readonly icon: string;
  /** The ring colour: a player colour or a neutral brass. */
  readonly ring: string;
  /** Size relative to a normal marker. */
  readonly size: number;
};

type TGlobeView = {
  /** Per cell: fog 0/128/255, toxic 0..255, owner index + 1, flag bits. */
  readonly state: Uint8Array;
  readonly ownerColors: readonly string[];
  readonly selectedIndex: number;
  readonly markers: readonly TGlobeMarker[];
};

type TGlobeScene = {
  readonly update: (view: TGlobeView) => void;
  readonly focus: (cellIndex: number, instant: boolean) => void;
  readonly dispose: () => void;
};

type TGlobeSceneOptions = {
  readonly onPick: (cellIndex: number) => void;
};

const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

const createStars = (seed: string) => {
  const rng = createRng(hashSeed(`${seed}:stars`));
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const phases = new Float32Array(STAR_COUNT);
  const tints = [
    [0.75, 0.82, 1],
    [1, 0.95, 0.85],
    [1, 0.82, 0.62],
    [0.9, 0.9, 0.95],
  ];

  for (let index = 0; index < STAR_COUNT; index += 1) {
    const z = rng() * 2 - 1;
    const angle = rng() * Math.PI * 2;
    const radius = Math.sqrt(1 - z * z);
    const distance = 60 + rng() * 30;
    positions.set([Math.cos(angle) * radius * distance, z * distance, Math.sin(angle) * radius * distance], index * 3);

    const brightness = (Math.pow(rng(), 3) * 0.9 + 0.1) * 0.45;
    const tint = tints[Math.floor(rng() * tints.length)] ?? [1, 1, 1];
    colors.set([(tint[0] ?? 1) * brightness, (tint[1] ?? 1) * brightness, (tint[2] ?? 1) * brightness], index * 3);
    sizes[index] = 1.5 + Math.pow(rng(), 6) * 4;
    phases[index] = rng();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: STARS_VERTEX,
    fragmentShader: STARS_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  return new THREE.Points(geometry, material);
};

/** Draws a map badge: a parchment disc, an ink ring in the owner colour, the icon. */
const drawBadge = (canvas: HTMLCanvasElement, ring: string, image: HTMLImageElement | null) => {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const half = BADGE_SIZE / 2;
  context.clearRect(0, 0, BADGE_SIZE, BADGE_SIZE);

  context.beginPath();
  context.arc(half, half, half - 6, 0, Math.PI * 2);
  context.fillStyle = "#eadfc4";
  context.fill();
  context.lineWidth = 10;
  context.strokeStyle = ring;
  context.stroke();

  context.beginPath();
  context.arc(half, half, half - 1.5, 0, Math.PI * 2);
  context.lineWidth = 3;
  context.strokeStyle = "#2a1f14";
  context.stroke();

  context.beginPath();
  context.arc(half, half, half - 11, 0, Math.PI * 2);
  context.lineWidth = 2;
  context.stroke();

  if (image && image.complete && image.naturalWidth > 0) {
    const inset = 26;
    context.drawImage(image, inset, inset, BADGE_SIZE - inset * 2, BADGE_SIZE - inset * 2);
  }
};

const createGlobeScene = (container: HTMLElement, world: TWorld, options: TGlobeSceneOptions): TGlobeScene => {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio));
  renderer.setClearColor(0x07080a, 1);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
  const cellCount = world.cells.length;
  const art = createGlobeAtlas();

  const stateData = new Uint8Array(cellCount * 4);
  const stateTexture = new THREE.DataTexture(stateData, cellCount, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  stateTexture.magFilter = THREE.NearestFilter;
  stateTexture.minFilter = THREE.NearestFilter;
  stateTexture.generateMipmaps = false;
  stateTexture.needsUpdate = true;

  const centers = new Float32Array(cellCount * 4);
  world.cells.forEach((cell) => {
    centers.set([cell.center[0], cell.center[1], cell.center[2], 1], cell.index * 4);
  });

  const ownerColors = Array.from({ length: MAX_OWNERS }, () => new THREE.Color(0xffffff));
  const planetUniforms = {
    uAtlas: { value: art.atlas },
    uPaper: { value: art.paper },
    uState: { value: stateTexture },
    uCameraPos: { value: camera.position },
    uTime: { value: 0 },
    uHover: { value: -1 },
    uSelected: { value: -1 },
    uGridAlpha: { value: 0.2 },
    uOwnerColors: { value: ownerColors },
  };

  const planetGeometry = buildGlobeGeometry(world);
  const planetMaterial = new THREE.ShaderMaterial({
    vertexShader: GLOBE_VERTEX,
    fragmentShader: GLOBE_FRAGMENT,
    uniforms: planetUniforms,
  });
  const planet = new THREE.Mesh(planetGeometry, planetMaterial);
  scene.add(planet);

  const stars = createStars(world.seed);
  const starUniforms = stars.material.uniforms as { uTime: { value: number }; uPixelRatio: { value: number } };
  scene.add(stars);

  const markerGroup = new THREE.Group();
  scene.add(markerGroup);

  // Camera orbit: the current angles chase the target ones.
  const orbit = {
    yaw: 0,
    pitch: 0.3,
    distance: CAMERA_START_DISTANCE,
    targetYaw: 0,
    targetPitch: 0.3,
    targetDistance: CAMERA_START_DISTANCE,
    spinYaw: 0,
    spinPitch: 0,
  };

  const centerOf = (index: number) => new THREE.Vector3(
    centers[index * 4] as number,
    centers[index * 4 + 1] as number,
    centers[index * 4 + 2] as number,
  );

  const focus = (cellIndex: number, instant: boolean) => {
    if (cellIndex < 0 || cellIndex >= cellCount) {
      return;
    }

    const center = centerOf(cellIndex);
    orbit.targetYaw = orbit.yaw + wrapAngle(Math.atan2(center.x, center.z) - orbit.yaw);
    orbit.targetPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.asin(center.y)));
    orbit.spinYaw = 0;
    orbit.spinPitch = 0;

    if (instant) {
      orbit.yaw = orbit.targetYaw;
      orbit.pitch = orbit.targetPitch;
    }
  };

  // Icon images and badge textures, shared by every marker that looks alike.
  const images = new Map<string, HTMLImageElement>();
  const badges = new Map<string, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>();
  const redrawOnLoad = new Map<string, Set<string>>();

  const badgeTexture = (icon: string, ring: string) => {
    const key = `${icon}|${ring}`;
    const known = badges.get(key);
    if (known) {
      return known.texture;
    }

    let image = images.get(icon);
    if (!image) {
      image = new Image();
      image.src = icon;
      images.set(icon, image);
      const loaded = image;
      loaded.onload = () => {
        for (const badgeKey of redrawOnLoad.get(icon) ?? []) {
          const badge = badges.get(badgeKey);
          if (badge) {
            const [, badgeRing] = badgeKey.split("|");
            drawBadge(badge.canvas, badgeRing ?? "#ffffff", loaded);
            badge.texture.needsUpdate = true;
          }
        }
      };
    }

    const canvas = document.createElement("canvas");
    canvas.width = BADGE_SIZE;
    canvas.height = BADGE_SIZE;
    drawBadge(canvas, ring, image);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    badges.set(key, { canvas, texture });

    const waiting = redrawOnLoad.get(icon) ?? new Set<string>();
    waiting.add(key);
    redrawOnLoad.set(icon, waiting);

    return texture;
  };

  type TSpriteEntry = { sprite: THREE.Sprite; material: THREE.SpriteMaterial; normal: THREE.Vector3; size: number };
  let sprites: TSpriteEntry[] = [];

  const clearSprites = () => {
    for (const entry of sprites) {
      markerGroup.remove(entry.sprite);
      entry.material.dispose();
    }

    sprites = [];
  };

  const update = (view: TGlobeView) => {
    stateData.set(view.state.subarray(0, stateData.length));
    stateTexture.needsUpdate = true;
    planetUniforms.uSelected.value = view.selectedIndex;

    view.ownerColors.slice(0, MAX_OWNERS).forEach((color, index) => {
      ownerColors[index]?.set(color);
    });

    clearSprites();
    for (const marker of view.markers) {
      const material = new THREE.SpriteMaterial({
        map: badgeTexture(marker.icon, marker.ring),
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      const normal = centerOf(marker.cellIndex).normalize();
      sprite.position.copy(normal).multiplyScalar(MARKER_LIFT);
      sprite.renderOrder = 10;
      markerGroup.add(sprite);
      sprites.push({ sprite, material, normal, size: marker.size });
    }
  };

  // --- input ---

  const raycaster = new THREE.Raycaster();
  const unitSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  const hitPoint = new THREE.Vector3();

  const pickAt = (clientX: number, clientY: number) => {
    const rect = container.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );

    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectSphere(unitSphere, hitPoint)) {
      return -1;
    }

    hitPoint.normalize();
    let best = -1;
    let bestDot = -2;
    for (let index = 0; index < cellCount; index += 1) {
      const value = hitPoint.x * (centers[index * 4] as number)
        + hitPoint.y * (centers[index * 4 + 1] as number)
        + hitPoint.z * (centers[index * 4 + 2] as number);
      if (value > bestDot) {
        bestDot = value;
        best = index;
      }
    }

    return best;
  };

  let dragging = false;
  let dragMoved = 0;
  let lastX = 0;
  let lastY = 0;
  let lastMoveTime = 0;
  let pendingHover: { x: number; y: number } | null = null;

  const dragScale = () => DRAG_SPEED * ((orbit.distance - 0.95) / (CAMERA_START_DISTANCE - 0.95));

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }

    dragging = true;
    dragMoved = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    lastMoveTime = performance.now();
    orbit.spinYaw = 0;
    orbit.spinPitch = 0;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) {
      if (event.target === renderer.domElement) {
        pendingHover = { x: event.clientX, y: event.clientY };
      }

      return;
    }

    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    const now = performance.now();
    const elapsed = Math.max(1, now - lastMoveTime) / 1000;
    lastX = event.clientX;
    lastY = event.clientY;
    lastMoveTime = now;
    dragMoved += Math.abs(dx) + Math.abs(dy);

    const speed = dragScale();
    orbit.targetYaw -= dx * speed;
    orbit.targetPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, orbit.targetPitch + dy * speed));
    orbit.spinYaw = (-dx * speed) / elapsed;
    orbit.spinPitch = (dy * speed) / elapsed;
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!dragging) {
      return;
    }

    dragging = false;
    // A drag that stopped before release should not keep spinning.
    if (performance.now() - lastMoveTime > 80) {
      orbit.spinYaw = 0;
      orbit.spinPitch = 0;
    }

    if (dragMoved > DRAG_SLOP_PX) {
      return;
    }

    orbit.spinYaw = 0;
    orbit.spinPitch = 0;
    const index = pickAt(event.clientX, event.clientY);
    if (index >= 0) {
      options.onPick(index);
    }
  };

  const onPointerLeave = () => {
    pendingHover = null;
    planetUniforms.uHover.value = -1;
    renderer.domElement.style.cursor = "";
  };

  const onDoubleClick = (event: MouseEvent) => {
    focus(pickAt(event.clientX, event.clientY), false);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * WHEEL_ZOOM);
    orbit.targetDistance = Math.max(CAMERA_MIN_DISTANCE, Math.min(CAMERA_MAX_DISTANCE, orbit.targetDistance * factor));
  };

  const canvas = renderer.domElement;
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("dblclick", onDoubleClick);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    starUniforms.uPixelRatio.value = renderer.getPixelRatio();
  };

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  // --- frame loop ---

  const startTime = performance.now();
  let lastFrameTime = startTime;
  const toCamera = new THREE.Vector3();

  const renderFrame = () => {
    const now = performance.now();
    const delta = Math.min(0.1, (now - lastFrameTime) / 1000);
    const time = (now - startTime) / 1000;
    lastFrameTime = now;

    if (!dragging && (orbit.spinYaw !== 0 || orbit.spinPitch !== 0)) {
      orbit.targetYaw += orbit.spinYaw * delta;
      orbit.targetPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, orbit.targetPitch + orbit.spinPitch * delta));
      const decay = Math.exp(-INERTIA_DECAY * delta);
      orbit.spinYaw = Math.abs(orbit.spinYaw * decay) < 1e-3 ? 0 : orbit.spinYaw * decay;
      orbit.spinPitch = Math.abs(orbit.spinPitch * decay) < 1e-3 ? 0 : orbit.spinPitch * decay;
    }

    const follow = 1 - Math.exp(-DAMPING * delta);
    orbit.yaw += (orbit.targetYaw - orbit.yaw) * follow;
    orbit.pitch += (orbit.targetPitch - orbit.pitch) * follow;
    orbit.distance += (orbit.targetDistance - orbit.distance) * follow;

    camera.position.set(
      Math.cos(orbit.pitch) * Math.sin(orbit.yaw) * orbit.distance,
      Math.sin(orbit.pitch) * orbit.distance,
      Math.cos(orbit.pitch) * Math.cos(orbit.yaw) * orbit.distance,
    );
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    planetUniforms.uTime.value = time;
    starUniforms.uTime.value = time;

    // The grid shows more as the camera closes in.
    const closeness = 1 - (orbit.distance - CAMERA_MIN_DISTANCE) / (CAMERA_MAX_DISTANCE - CAMERA_MIN_DISTANCE);
    planetUniforms.uGridAlpha.value = 0.25 + 0.35 * closeness;

    if (pendingHover) {
      const index = pickAt(pendingHover.x, pendingHover.y);
      planetUniforms.uHover.value = index;
      canvas.style.cursor = index >= 0 ? "pointer" : "";
      pendingHover = null;
    }

    // Markers fade out toward the limb and keep a steady size on screen.
    const markerScale = 0.62 + 0.38 * (orbit.distance / CAMERA_START_DISTANCE);
    for (const entry of sprites) {
      toCamera.copy(camera.position).sub(entry.sprite.position).normalize();
      const facing = entry.normal.dot(toCamera);
      entry.material.opacity = THREE.MathUtils.smoothstep(facing, 0.12, 0.38);
      entry.sprite.visible = entry.material.opacity > 0.01;
      const size = 0.075 * entry.size * markerScale;
      entry.sprite.scale.set(size, size, 1);
    }

    renderer.render(scene, camera);
  };

  renderer.setAnimationLoop(renderFrame);

  const dispose = () => {
    renderer.setAnimationLoop(null);
    observer.disconnect();
    canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("dblclick", onDoubleClick);
    canvas.removeEventListener("wheel", onWheel);

    clearSprites();
    for (const badge of badges.values()) {
      badge.texture.dispose();
    }

    for (const image of images.values()) {
      image.onload = null;
    }

    planetGeometry.dispose();
    planetMaterial.dispose();
    stars.geometry.dispose();
    stars.material.dispose();
    stateTexture.dispose();
    art.dispose();
    renderer.dispose();
    container.removeChild(canvas);
  };

  return { update, focus, dispose };
};

export type { TGlobeMarker, TGlobeScene, TGlobeView };
export { createGlobeScene };
