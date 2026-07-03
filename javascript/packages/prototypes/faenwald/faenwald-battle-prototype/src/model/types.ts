/**
 * Model layer — core domain primitives.
 *
 * The small, dependency-free types shared across the battle engine (hex math,
 * zones, the catalog). These are pure data shapes — no MobX, no React — so the
 * engine stays unit-testable in isolation (GDD §15).
 */

/** Axial hex coordinate. The cube `s` is always derivable as `-q - r` (§2.1). */
export interface Axial {
  q: number;
  r: number;
}

/**
 * Facing as one of 6 directions, each pointing at the **shared vertex between
 * two adjacent neighbour hexes** — so the two hexes flanking that vertex form
 * the unit's front (§2.2). Index `f` ⇒ front hexes are direction `f` and
 * `f + 1` (see {@link HEX_DIRECTIONS} in `hex.ts`).
 */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5;

/** The two belligerents. Blue acts first in the initiative alternation (§1, §6.1). */
export type Side = 'blue' | 'red';

/** A defender's three attack zones relative to its facing (§2.2). */
export type Zone = 'front' | 'flank' | 'rear';
