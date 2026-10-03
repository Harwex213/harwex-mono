import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import { ICONS } from "../../core/icons";
import { getCell } from "../../core/world-gen";
import { cellVisibility, reachableCellIds } from "../../core/world-rules";
import { useStore } from "../../store/store";
import { createGlobeScene } from "./globe-scene";
import type { FC } from "react";
import type { TPlayer } from "../../core/types";
import type { TWorld, TWorldCell } from "../../core/world-gen";
import type { TSelectWorldCellAction } from "../../domain/registry";
import type { TGlobeMarker, TGlobeScene, TGlobeView } from "./globe-scene";

/**
 * The spec's "3D шар из гексов", drawn as an antique fantasy map: a world of
 * hexes where each cell is a hand-drawn island, a settlement or clouds over
 * an inked sea, with hatched mist for the unexplored and badges on top. The scene lives in `globe-scene.ts`; this component turns
 * the world state into what the scene shows.
 */

/** A trail this big paints the cell fully toxic. */
const TOXIC_FULL = 400;
const FOG_LEVEL = { revealed: 255, frontier: 128, fogged: 0 } as const;
const FLAG_REACHABLE = 1;
const FLAG_HOME = 2;
const BRASS = "#8a6a32";
const MONSTER_RING = "#7a5a3a";
/** An activated island: its fight is on. */
const ACTIVE_RING = "#a3261d";
/** Wild islands in a cell, drawn as a beast that grows with their number. */
const MONSTER_ICONS = [ICONS.wolf, ICONS.skeleton, ICONS.ogre];

type TGlobeRegistrySlice = {
  selectWorldCellAction: TSelectWorldCellAction;
};

type TGlobeProps = {
  registry: TGlobeRegistrySlice;
};

/** The one badge a scouted cell shows: its owner, or its wild islands. */
const markerFor = (cell: TWorldCell, players: readonly TPlayer[]): TGlobeMarker | null => {
  if (!cell.revealed) {
    return null;
  }

  const owner = cell.ownerId ? players.find((player) => player.id === cell.ownerId) : undefined;
  if (owner) {
    return {
      key: `${cell.id}:owner`,
      cellIndex: cell.index,
      icon: ICONS.stronghold,
      ring: owner.color,
      size: owner.isHuman ? 1.25 : 1.05,
    };
  }

  if (cell.kind !== "island") {
    return null;
  }

  if (cell.cleared || cell.islandCount === 0) {
    return { key: `${cell.id}:cleared`, cellIndex: cell.index, icon: ICONS.check, ring: BRASS, size: 0.6 };
  }

  const icon = MONSTER_ICONS[Math.min(MONSTER_ICONS.length, cell.islandCount) - 1] ?? ICONS.wolf;

  return {
    key: `${cell.id}:islands`,
    cellIndex: cell.index,
    icon,
    ring: cell.activated ? ACTIVE_RING : MONSTER_RING,
    size: 0.42 + cell.islandCount * 0.05,
  };
};

/** The compass rose in the corner, as on every old map. */
const CompassRose: FC = () => {
  return (
    <svg className="globe-compass" viewBox="-50 -50 100 100" aria-hidden="true">
      <circle r="34" fill="none" stroke="#c9b48a" strokeWidth="1.2" />
      <circle r="27" fill="none" stroke="#c9b48a" strokeWidth="0.6" strokeDasharray="2 2" />
      <path d="M0 -32 L6 -6 L0 0 L-6 -6 Z" fill="#e8dcc0" stroke="#2a1f14" strokeWidth="0.8" />
      <path d="M0 46 L6 6 L0 0 L-6 6 Z" fill="#8a7550" stroke="#2a1f14" strokeWidth="0.8" />
      <path d="M46 0 L6 6 L0 0 L6 -6 Z" fill="#8a7550" stroke="#2a1f14" strokeWidth="0.8" />
      <path d="M-46 0 L-6 6 L0 0 L-6 -6 Z" fill="#e8dcc0" stroke="#2a1f14" strokeWidth="0.8" />
      <path d="M0 -6 L22 -22 L6 0 Z M0 6 L-22 22 L-6 0 Z" fill="#a8916a" opacity="0.7" />
      <path d="M6 0 L22 22 L0 6 Z M-6 0 L-22 -22 L0 -6 Z" fill="#a8916a" opacity="0.7" />
      <text y="-37" textAnchor="middle" className="globe-compass__n">
        {"N"}
      </text>
    </svg>
  );
};

const buildView = (
  world: TWorld,
  players: readonly TPlayer[],
  homeCellId: string,
  movedThisTurn: boolean,
  selectedCellId: string | null,
): TGlobeView => {
  const state = new Uint8Array(world.cells.length * 4);
  const ownerIndex = new Map(players.map((player, index) => [player.id, index]));
  const reachable = new Set(reachableCellIds(world, homeCellId, movedThisTurn));
  const markers: TGlobeMarker[] = [];

  for (const cell of world.cells) {
    const offset = cell.index * 4;
    state[offset] = FOG_LEVEL[cellVisibility(world, cell)];

    // Fog of war hides everything that sits in a cell.
    if (cell.revealed) {
      state[offset + 1] = Math.round(Math.sqrt(Math.min(1, cell.toxicTrail / TOXIC_FULL)) * 255);
      state[offset + 2] = cell.ownerId ? (ownerIndex.get(cell.ownerId) ?? -1) + 1 : 0;
    }

    let flags = 0;
    if (reachable.has(cell.id)) {
      flags |= FLAG_REACHABLE;
    }

    if (cell.id === homeCellId) {
      flags |= FLAG_HOME;
    }

    state[offset + 3] = flags;

    const marker = markerFor(cell, players);
    if (marker) {
      markers.push(marker);
    }
  }

  const selected = selectedCellId ? getCell(world, selectedCellId) : null;

  return {
    state,
    ownerColors: players.map((player) => player.color),
    selectedIndex: selected ? selected.index : -1,
    markers,
  };
};

const Globe: FC<TGlobeProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const world = store.world.world.value;
  const selectedCellId = store.world.selectedCellId.value;
  const movedThisTurn = store.world.movedThisTurn.value;
  const players = store.game.players.value;
  const homeCellId = store.derived.humanPlayer.value?.cellId ?? "";

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TGlobeScene | null>(null);
  const registryRef = useRef(registry);
  const worldRef = useRef(world);
  const focusedCellRef = useRef<string | null>(null);
  registryRef.current = registry;
  worldRef.current = world;

  const seed = world?.seed ?? null;
  const cellCount = world?.cells.length ?? 0;

  // The scene is built once per planet; state changes only update it.
  useEffect(() => {
    const container = containerRef.current;
    const current = worldRef.current;
    if (!container || !current) {
      return;
    }

    const scene = createGlobeScene(container, current, {
      onPick: (cellIndex) => {
        const cell = worldRef.current?.cells[cellIndex];
        if (cell) {
          registryRef.current.selectWorldCellAction(cell.id);
        }
      },
    });

    sceneRef.current = scene;
    focusedCellRef.current = null;

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [seed, cellCount]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !world) {
      return;
    }

    scene.update(buildView(world, players, homeCellId, movedThisTurn, selectedCellId));

    // The camera starts over the island and follows it when it flies.
    if (focusedCellRef.current !== homeCellId) {
      const home = getCell(world, homeCellId);
      if (home) {
        scene.focus(home.index, focusedCellRef.current === null);
      }

      focusedCellRef.current = homeCellId;
    }
  }, [world, players, homeCellId, movedThisTurn, selectedCellId, seed, cellCount]);

  return (
    <div className="globe" ref={containerRef}>
      <CompassRose />
    </div>
  );
};

export { Globe };
