import { effect } from "@preact/signals-react";
import { useEffect, useRef } from "react";
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  RingGeometry,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { createGlobeMesh, updateGlobeColours } from "./globe-mesh";
import { cellsWithinDistance, moveRangeFor } from "../../domain/world-actions";
import { createRng } from "../../core/exports";
import { HUMAN_PLAYER_ID, useStore } from "../../store/store";
import { PALETTE, PLAYER_COLOURS } from "../palette";
import type { FC } from "react";
import type { TSelectCellAction } from "../../domain/registry";

/**
 * The exploration page's hero object (spec node `3d`, reference
 * `01-spec-image-11.png`): the 92-cell globe on a starfield, orbited by drag,
 * dollied by wheel and picked with a `Raycaster`.
 *
 * The whole scene is built once in one effect and torn down in its cleanup:
 * the RAF handle, every listener, the ResizeObserver, every geometry, every
 * material, the sprite texture and the renderer itself (plan §7).
 */

type TWorldGlobeRegistrySlice = {
  selectCell: TSelectCellAction;
};

type TWorldGlobeProps = {
  registry: TWorldGlobeRegistrySlice;
};

const CANVAS_LABEL_RU = "Глобальная карта";

const CAMERA_FOV_DEG = 42;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 200;
const CAMERA_START_RADIUS = 3.2;
const CAMERA_MIN_RADIUS = 1.6;
const CAMERA_MAX_RADIUS = 6;

/** Radians of orbit per pixel of drag. */
const ORBIT_RATE_RAD_PER_PX = 0.006;

/** How close to a pole the camera may come, in radians. */
const POLAR_MARGIN_RAD = 0.18;

/** One mouse-wheel notch. */
const WHEEL_DOLLY_STEP = 1.12;

/** Pointer travel below this many pixels still counts as a click, not a drag. */
const CLICK_SLOP_PX = 4;

/** A press held longer than this is a drag even when the pointer never moved. */
const CLICK_MAX_MS = 300;

const STAR_COUNT = 800;
const STAR_RADIUS = 40;
const STAR_SIZE = 0.28;
const STAR_SEED = 20260919;

const AMBIENT_INTENSITY = 1.15;
const KEY_LIGHT_INTENSITY = 1.35;
const KEY_LIGHT_POSITION: readonly [number, number, number] = [4, 5, 3];

/** The island badge floats this far above the tile it stands on. */
const MARKER_RADIUS = 1.06;
const MARKER_SCALE = 0.3;
const MARKER_TEXTURE_PX = 128;
const MARKER_DISC_RATIO = 0.8;
const MARKER_RING_RATIO = 0.08;
const MARKER_GLYPH_RATIO = 0.62;
const MARKER_GLYPH_BASELINE_RATIO = 0.03;

/** The player island, drawn into the badge in the page background colour. */
const MARKER_GLYPH = "⬢";

/** The reachable rings, and how many the pool holds: six neighbours, or 18 with levitation. */
const RING_RADIUS = 1.02;
const RING_INNER = 0.055;
const RING_OUTER = 0.085;
const RING_SEGMENTS = 28;
const RING_POOL_SIZE = 24;
const RING_REVEALED_COLOUR = PALETTE.toxic;
const RING_UNKNOWN_COLOUR = PALETTE.gold;
const RING_BASE_OPACITY = 0.85;

/** The rings breathe at this rate, in radians per second. */
const PULSE_RATE_RAD_PER_S = 3;
const PULSE_AMPLITUDE = 0.18;
const MS_PER_S = 1000;

const BACKGROUND_COLOUR = PALETTE.bgDeep;
const DEFAULT_DPR = 1;
const MAX_DPR = 2;
const MIN_CANVAS_PX = 1;
const NDC_SCALE = 2;
const VECTOR_COMPONENTS = 3;

/** The round badge that marks the player's island, drawn once into a canvas texture. */
const createMarkerTexture = (colour: string): CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = MARKER_TEXTURE_PX;
  canvas.height = MARKER_TEXTURE_PX;
  const ctx = canvas.getContext("2d");
  const centre = MARKER_TEXTURE_PX / 2;
  if (ctx !== null) {
    ctx.beginPath();
    ctx.arc(centre, centre, centre * MARKER_DISC_RATIO, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.lineWidth = MARKER_TEXTURE_PX * MARKER_RING_RATIO;
    ctx.strokeStyle = PALETTE.gold;
    ctx.stroke();
    ctx.fillStyle = PALETTE.bgDeep;
    ctx.font = `${Math.round(MARKER_TEXTURE_PX * MARKER_GLYPH_RATIO)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(MARKER_GLYPH, centre, centre + MARKER_TEXTURE_PX * MARKER_GLYPH_BASELINE_RATIO);
  }

  return new CanvasTexture(canvas);
};

/** A seeded shell of stars, far enough out that the orbit never reaches it. */
const createStarfield = (): Points => {
  const rng = createRng(STAR_SEED);
  const positions = new Float32Array(STAR_COUNT * VECTOR_COMPONENTS);
  for (let index = 0; index < STAR_COUNT; index += 1) {
    const z = rng.next() * 2 - 1;
    const angle = rng.next() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    positions[index * VECTOR_COMPONENTS] = Math.cos(angle) * ring * STAR_RADIUS;
    positions[index * VECTOR_COMPONENTS + 1] = Math.sin(angle) * ring * STAR_RADIUS;
    positions[index * VECTOR_COMPONENTS + 2] = z * STAR_RADIUS;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, VECTOR_COMPONENTS));

  return new Points(geometry, new PointsMaterial({ color: new Color("#ffffff"), size: STAR_SIZE }));
};

const WorldGlobe: FC<TWorldGlobeProps> = ({ registry }) => {
  const store = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const renderer = new WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(new Color(BACKGROUND_COLOUR), 1);

    const scene = new Scene();
    const camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, CAMERA_NEAR, CAMERA_FAR);
    scene.add(new AmbientLight(new Color("#8ea7c8"), AMBIENT_INTENSITY));
    const keyLight = new DirectionalLight(new Color("#ffffff"), KEY_LIGHT_INTENSITY);
    keyLight.position.set(KEY_LIGHT_POSITION[0], KEY_LIGHT_POSITION[1], KEY_LIGHT_POSITION[2]);
    scene.add(keyLight);

    const stars = createStarfield();
    scene.add(stars);

    const cells = store.game.worldCells.peek();
    const handle = createGlobeMesh(cells);
    scene.add(handle.group);

    const human = store.game.players.peek().find((player) => player.id === HUMAN_PLAYER_ID);
    const markerTexture = createMarkerTexture(human === undefined ? PLAYER_COLOURS.green : human.colour);
    const markerMaterial = new SpriteMaterial({ map: markerTexture, transparent: true });
    const marker = new Sprite(markerMaterial);
    marker.scale.set(MARKER_SCALE, MARKER_SCALE, MARKER_SCALE);
    marker.renderOrder = 2;
    scene.add(marker);

    const ringGeometry = new RingGeometry(RING_INNER, RING_OUTER, RING_SEGMENTS);
    const rings: Mesh[] = [];
    const ringMaterials: MeshBasicMaterial[] = [];
    for (let index = 0; index < RING_POOL_SIZE; index += 1) {
      const material = new MeshBasicMaterial({
        color: new Color(RING_REVEALED_COLOUR),
        transparent: true,
        opacity: RING_BASE_OPACITY,
        depthWrite: false,
      });
      const ring = new Mesh(ringGeometry, material);
      ring.visible = false;
      ring.renderOrder = 1;
      ringMaterials.push(material);
      rings.push(ring);
      scene.add(ring);
    }

    const orbit = { radius: CAMERA_START_RADIUS, theta: 0, phi: Math.PI / 2 };
    const startCell = cells.find((cell) => {
      return cell.id === store.game.islandCellId.peek();
    });
    if (startCell !== undefined) {
      orbit.theta = Math.atan2(startCell.centre[0], startCell.centre[2]);
      orbit.phi = Math.acos(Math.max(-1, Math.min(1, startCell.centre[1])));
      orbit.phi = Math.max(POLAR_MARGIN_RAD, Math.min(Math.PI - POLAR_MARGIN_RAD, orbit.phi));
    }

    const placeCamera = (): void => {
      const sinPhi = Math.sin(orbit.phi);
      camera.position.set(
        orbit.radius * sinPhi * Math.sin(orbit.theta),
        orbit.radius * Math.cos(orbit.phi),
        orbit.radius * sinPhi * Math.cos(orbit.theta),
      );
      camera.lookAt(0, 0, 0);
    };

    const measure = (): void => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(MIN_CANVAS_PX, Math.round(rect.width));
      const height = Math.max(MIN_CANVAS_PX, Math.round(rect.height));
      renderer.setPixelRatio(Math.min(MAX_DPR, window.devicePixelRatio || DEFAULT_DPR));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    /** Everything that depends on a signal: the tile colours, the badge and the reachable rings. */
    const syncScene = (): void => {
      const currentCells = store.game.worldCells.value;
      const selectedCellId = store.ui.selectedCellId.value;
      const islandCellId = store.game.islandCellId.value;
      const researched = store.game.researched.value;

      updateGlobeColours(handle, currentCells, selectedCellId);

      const islandCell = currentCells.find((cell) => {
        return cell.id === islandCellId;
      });
      if (islandCell === undefined) {
        marker.visible = false;
      } else {
        marker.visible = true;
        marker.position.set(
          islandCell.centre[0] * MARKER_RADIUS,
          islandCell.centre[1] * MARKER_RADIUS,
          islandCell.centre[2] * MARKER_RADIUS,
        );
      }

      const reachable = cellsWithinDistance(currentCells, islandCellId, moveRangeFor(researched));
      for (let index = 0; index < rings.length; index += 1) {
        const ring = rings[index];
        const material = ringMaterials[index];
        const cellId = reachable[index];
        if (ring === undefined || material === undefined) {
          continue;
        }

        if (cellId === undefined) {
          ring.visible = false;
          continue;
        }

        const cell = currentCells.find((candidate) => {
          return candidate.id === cellId;
        });
        if (cell === undefined) {
          ring.visible = false;
          continue;
        }

        const position = new Vector3(
          cell.centre[0] * RING_RADIUS,
          cell.centre[1] * RING_RADIUS,
          cell.centre[2] * RING_RADIUS,
        );
        ring.visible = true;
        ring.position.copy(position);
        ring.lookAt(position.clone().multiplyScalar(2));
        material.color.set(cell.revealed === true ? RING_REVEALED_COLOUR : RING_UNKNOWN_COLOUR);
      }
    };

    let frame = 0;
    const render = (nowMs: number): void => {
      const pulse = 1 + PULSE_AMPLITUDE * Math.sin((nowMs / MS_PER_S) * PULSE_RATE_RAD_PER_S);
      for (const ring of rings) {
        if (ring.visible === true) {
          ring.scale.set(pulse, pulse, pulse);
        }
      }

      placeCamera();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };

    const raycaster = new Raycaster();
    const pickCell = (clientX: number, clientY: number): number | null => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return null;
      }

      const ndc = new Vector2(
        ((clientX - rect.left) / rect.width) * NDC_SCALE - 1,
        -(((clientY - rect.top) / rect.height) * NDC_SCALE - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects([...handle.cellMeshes], false)[0];
      if (hit === undefined) {
        return null;
      }

      const cellId = hit.object.userData["cellId"];

      return typeof cellId === "number" ? cellId : null;
    };

    const drag = { active: false, lastX: 0, lastY: 0, startX: 0, startY: 0, startedAtMs: 0 };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) {
        return;
      }

      drag.active = true;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      drag.startedAtMs = performance.now();
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (drag.active === false) {
        return;
      }

      const deltaX = event.clientX - drag.lastX;
      const deltaY = event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      orbit.theta -= deltaX * ORBIT_RATE_RAD_PER_PX;
      orbit.phi = Math.max(
        POLAR_MARGIN_RAD,
        Math.min(Math.PI - POLAR_MARGIN_RAD, orbit.phi - deltaY * ORBIT_RATE_RAD_PER_PX),
      );
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (drag.active === false) {
        return;
      }

      drag.active = false;
      const travelled = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
      const elapsedMs = performance.now() - drag.startedAtMs;
      if (travelled > CLICK_SLOP_PX || elapsedMs > CLICK_MAX_MS) {
        return;
      }

      registry.selectCell(pickCell(event.clientX, event.clientY));
    };

    // React's `onWheel` prop is passive, so `preventDefault` there silently fails
    // and the page scrolls instead of dollying (plan §7).
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();

      const factor = event.deltaY < 0 ? 1 / WHEEL_DOLLY_STEP : WHEEL_DOLLY_STEP;
      orbit.radius = Math.max(CAMERA_MIN_RADIUS, Math.min(CAMERA_MAX_RADIUS, orbit.radius * factor));
    };

    measure();
    placeCamera();
    const stopSync = effect(syncScene);
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(canvas);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      stopSync();
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      scene.clear();
      handle.dispose();
      stars.geometry.dispose();
      const starMaterial = stars.material;
      if (Array.isArray(starMaterial)) {
        for (const material of starMaterial) {
          material.dispose();
        }
      } else {
        starMaterial.dispose();
      }
      ringGeometry.dispose();
      for (const material of ringMaterials) {
        material.dispose();
      }
      markerTexture.dispose();
      markerMaterial.dispose();
      renderer.dispose();
    };
  }, [registry, store]);

  return (
    <canvas ref={canvasRef} className="world-globe" aria-label={CANVAS_LABEL_RU} />
  );
};

export type { TWorldGlobeRegistrySlice };
export { WorldGlobe };
