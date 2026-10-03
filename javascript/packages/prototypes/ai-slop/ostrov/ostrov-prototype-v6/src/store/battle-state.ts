import { signal } from "@preact/signals-react";
import type { TCleanupHud, TCleanupResult, TCleanupSim } from "../core/cleanup-sim";
import type { TUnitId } from "../core/units";

type TCleanupSpeed = 1 | 2;

/**
 * The cleanup phase level. The sim object is mutated in place by its ticks, so
 * nothing subscribes to it: the canvas reads it every frame. The HUD reads the
 * `hud` snapshot instead, which changes only when a count changes.
 */
const createBattleState = () => ({
  /** The running level, or `null` outside the cleanup phase. */
  sim: signal<TCleanupSim | null>(null),
  hud: signal<TCleanupHud | null>(null),
  /** The army as it was levied. The HUD shows alive out of these. */
  roster: signal<readonly TUnitId[]>([]),
  /** Set when the level ends. The results modal shows it. */
  result: signal<TCleanupResult | null>(null),
  speed: signal<TCleanupSpeed>(1),
  paused: signal<boolean>(false),
  /** Set once the result has been handed back to the island. */
  resolved: signal<boolean>(false),
});

type TBattleState = ReturnType<typeof createBattleState>;

export type { TBattleState, TCleanupSpeed };
export { createBattleState };
