import { signal } from "@preact/signals-react";
import type { TBattle } from "../core/battle-sim";
import type { TUnitId } from "../core/units";

/** The clearing phase level, or `null` outside that phase. */
const createBattleState = () => ({
  battle: signal<TBattle | null>(null),
  /** The army as it was levied, so losses can be charged to the population. */
  roster: signal<readonly TUnitId[]>([]),
  /** Set once the result has been handed back to the island. */
  resolved: signal<boolean>(false),
});

type TBattleState = ReturnType<typeof createBattleState>;

export type { TBattleState };
export { createBattleState };
