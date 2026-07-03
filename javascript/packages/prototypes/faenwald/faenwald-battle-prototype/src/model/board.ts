/**
 * Model layer — observable Hex and Board (GDD §15.1).
 *
 * The board is a collection of {@link Hex} tiles keyed by axial coordinate.
 * Each Hex carries its terrain, elevation and transient state (mud/frozen) as
 * observable fields, so the View re-renders when (in later phases) a plain
 * turns to mud or water freezes. The Board itself is a static container of
 * those observable tiles — its membership does not change during a battle.
 */

import { makeAutoObservable } from 'mobx';
import { TERRAIN, type Elevation, type HexState, type TerrainType } from './terrain.ts';
import type { Axial } from './types.ts';

/** Canonical string key for an axial coordinate, e.g. `"2,-1"`. */
export function coordKey(coord: Axial): string {
  return `${coord.q},${coord.r}`;
}

/** A single board tile (§15.1). Terrain/elevation/state are observable. */
export class Hex {
  readonly q: number;
  readonly r: number;
  terrain: TerrainType;
  elevation: Elevation;
  state: HexState;

  constructor(init: {
    coord: Axial;
    terrain: TerrainType;
    elevation?: Elevation;
    state?: HexState;
  }) {
    this.q = init.coord.q;
    this.r = init.coord.r;
    this.terrain = init.terrain;
    // Default the elevation from the terrain type unless explicitly overridden.
    this.elevation = init.elevation ?? TERRAIN[init.terrain].elevation;
    this.state = init.state ?? null;
    makeAutoObservable(this);
  }

  get coord(): Axial {
    return { q: this.q, r: this.r };
  }

  get key(): string {
    return coordKey(this.coord);
  }

  /** Frozen water behaves like a plain and so becomes passable (§10/#6). */
  get isPassable(): boolean {
    return TERRAIN[this.terrain].passable || this.state === 'frozen';
  }

  /** Whether ranged line of fire is blocked here (mountains, §2.3/§10). */
  get blocksLineOfFire(): boolean {
    return TERRAIN[this.terrain].blocksLineOfFire;
  }
}

/** The set of tiles making up a battlefield. */
export class Board {
  private readonly byKey = new Map<string, Hex>();
  readonly hexes: Hex[];

  constructor(hexes: Hex[]) {
    this.hexes = hexes;
    for (const hex of hexes) {
      this.byKey.set(hex.key, hex);
    }
  }

  get(coord: Axial): Hex | undefined {
    return this.byKey.get(coordKey(coord));
  }

  has(coord: Axial): boolean {
    return this.byKey.has(coordKey(coord));
  }

  /** Axial bounding box of the board, for laying out the view. */
  get bounds(): { minQ: number; maxQ: number; minR: number; maxR: number } {
    let minQ = Infinity;
    let maxQ = -Infinity;
    let minR = Infinity;
    let maxR = -Infinity;
    for (const hex of this.hexes) {
      if (hex.q < minQ) minQ = hex.q;
      if (hex.q > maxQ) maxQ = hex.q;
      if (hex.r < minR) minR = hex.r;
      if (hex.r > maxR) maxR = hex.r;
    }
    return { minQ, maxQ, minR, maxR };
  }
}
