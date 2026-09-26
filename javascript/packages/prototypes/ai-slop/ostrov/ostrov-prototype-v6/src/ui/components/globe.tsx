import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { getBiome } from "../../core/biomes";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TWorld } from "../../core/world-gen";
import type { TSelectWorldCellAction } from "../../domain/registry";

/**
 * The spec's "3D шар из гексов": the dual of a subdivided icosahedron, one
 * mesh per cell, dragged with the mouse and zoomed with the wheel.
 */

const GLOBE_RADIUS = 1;
/** Cells float just above the sphere, so their edges do not fight with it. */
const CELL_LIFT = 1.004;
/**
 * A cell is drawn flat, so its middle dips well below the sphere it sits on.
 * The core has to stay under that dip, or it pokes through every cell as a
 * dark wedge.
 */
const CORE_RADIUS = 0.9;
const MARKER_LIFT = 1.06;
const CAMERA_MIN_Z = 2.1;
const CAMERA_MAX_Z = 5.4;
const CAMERA_START_Z = 3.3;
const ZOOM_STEP = 1.1;
const DRAG_SPEED = 0.006;
const DRAG_SLOP_PX = 4;
const UNSEEN_COLOR = 0x28303c;
const TOXIC_COLOR = new THREE.Color(0x9bff4f);
/** A trail this big paints the cell fully toxic. */
const TOXIC_FULL = 400;

type TGlobeRegistrySlice = {
  selectWorldCellAction: TSelectWorldCellAction;
};

type TGlobeProps = {
  registry: TGlobeRegistrySlice;
};

const cellColor = (world: TWorld, cellId: string, colorByPlayer: ReadonlyMap<string, string>) => {
  const cell = world.cells.find((candidate) => candidate.id === cellId);
  if (!cell) {
    return new THREE.Color(UNSEEN_COLOR);
  }

  if (!cell.revealed) {
    return new THREE.Color(UNSEEN_COLOR);
  }

  const owner = cell.ownerId ? colorByPlayer.get(cell.ownerId) : undefined;
  const base = new THREE.Color(owner ?? getBiome(cell.biome).color);

  return base.lerp(TOXIC_COLOR, Math.min(1, cell.toxicTrail / TOXIC_FULL) * 0.7);
};

const Globe: FC<TGlobeProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const world = store.world.world.value;
  const selectedCellId = store.world.selectedCellId.value;
  const players = store.game.players.value;

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    globe: THREE.Group;
    cells: THREE.Group;
    meshes: Map<string, THREE.Mesh>;
  } | null>(null);

  // The renderer is built once; the cells are rebuilt whenever the world moves.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, CAMERA_START_Z);

    const globe = new THREE.Group();
    scene.add(globe);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * CORE_RADIUS, 48, 32),
      new THREE.MeshStandardMaterial({ color: 0x0d1420, roughness: 1 }),
    );
    globe.add(core);

    const cells = new THREE.Group();
    globe.add(cells);

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 2, 4);
    scene.add(key);

    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(1200 * 3);
    for (let index = 0; index < 1200; index += 1) {
      const direction = new THREE.Vector3().randomDirection().multiplyScalar(30 + Math.random() * 20);
      starPositions.set([direction.x, direction.y, direction.z], index * 3);
    }

    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x8fa3b2, size: 0.12 })));

    sceneRef.current = { renderer, scene, camera, globe, cells, meshes: new Map() };

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };

    resize();
    window.addEventListener("resize", resize);

    let frame = requestAnimationFrame(function loop() {
      renderer.render(scene, camera);
      frame = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // Cells, markers and colours follow the world state.
  useEffect(() => {
    const current = sceneRef.current;
    if (!current || !world) {
      return;
    }

    const colorByPlayer = new Map(players.map((player) => [player.id, player.color]));

    current.cells.clear();
    current.meshes.clear();

    for (const cell of world.cells) {
      const center = new THREE.Vector3(...cell.center);
      const corners = cell.polygon.map((point) => new THREE.Vector3(...point));
      const positions: number[] = [];

      for (let index = 0; index < corners.length; index += 1) {
        const a = corners[index] as THREE.Vector3;
        const b = corners[(index + 1) % corners.length] as THREE.Vector3;
        positions.push(
          center.x * CELL_LIFT, center.y * CELL_LIFT, center.z * CELL_LIFT,
          a.x * CELL_LIFT, a.y * CELL_LIFT, a.z * CELL_LIFT,
          b.x * CELL_LIFT, b.y * CELL_LIFT, b.z * CELL_LIFT,
        );
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();

      const isSelected = cell.id === selectedCellId;
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: cellColor(world, cell.id, colorByPlayer),
          roughness: 0.85,
          // A cell is a fan over corners sorted by angle, and a tie in that
          // sort flips one wedge. Drawing both sides covers the hole that
          // back-face culling would otherwise cut into the cell.
          side: THREE.DoubleSide,
          emissive: new THREE.Color(isSelected ? 0xd8b45c : 0x000000),
          emissiveIntensity: isSelected ? 0.55 : 0,
        }),
      );
      mesh.userData.cellId = cell.id;
      current.cells.add(mesh);
      current.meshes.set(cell.id, mesh);

      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(corners.map((point) => point.clone().multiplyScalar(CELL_LIFT))),
        new THREE.LineBasicMaterial({ color: isSelected ? 0xf0d488 : 0x101720 }),
      );
      current.cells.add(outline);

      // An unscouted cell gives nothing away, not even who stands on it.
      if (!cell.revealed) {
        continue;
      }

      if (cell.ownerId) {
        const marker = new THREE.Mesh(
          new THREE.ConeGeometry(0.045, 0.12, 8),
          new THREE.MeshStandardMaterial({ color: colorByPlayer.get(cell.ownerId) ?? "#ffffff" }),
        );
        marker.position.copy(center.clone().multiplyScalar(MARKER_LIFT));
        marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), center.clone().normalize());
        current.cells.add(marker);

        continue;
      }

      // The scouting report: one dot per island sitting in the cell.
      for (let index = 0; index < cell.islandCount; index += 1) {
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.022, 8, 8),
          new THREE.MeshStandardMaterial({ color: 0xe8f1f2 }),
        );
        const offset = new THREE.Vector3(0, 0, 0).randomDirection().multiplyScalar(0.03);
        dot.position.copy(center.clone().multiplyScalar(MARKER_LIFT).add(offset).addScaledVector(center, index * 0.015));
        current.cells.add(dot);
      }
    }
  }, [players, selectedCellId, world]);

  // Drag to turn the globe, wheel to zoom, click to pick a cell.
  useEffect(() => {
    const container = containerRef.current;
    const current = sceneRef.current;
    if (!container || !current) {
      return;
    }

    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      moved = 0;
      lastX = event.clientX;
      lastY = event.clientY;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) {
        return;
      }

      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      moved += Math.abs(dx) + Math.abs(dy);

      current.globe.rotation.y += dx * DRAG_SPEED;
      current.globe.rotation.x = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, current.globe.rotation.x + dy * DRAG_SPEED),
      );
    };

    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (moved > DRAG_SLOP_PX) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, current.camera);
      const hit = raycaster.intersectObjects([...current.meshes.values()], false)[0];
      const cellId = hit?.object.userData.cellId;
      if (typeof cellId === "string") {
        registry.selectWorldCellAction(cellId);
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.pow(ZOOM_STEP, event.deltaY / 100);
      current.camera.position.z = Math.max(CAMERA_MIN_Z, Math.min(CAMERA_MAX_Z, current.camera.position.z * factor));
    };

    container.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("wheel", onWheel);
    };
  }, [registry]);

  return <div className="globe" ref={containerRef} />;
};

export { Globe };
