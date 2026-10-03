import { signal } from "@preact/signals-react";

/** The pages of the spec: island, global map, battle. The game opens on the island. */
type TPage = "island" | "world" | "battle";

const createRouteState = () => ({
  page: signal<TPage>("island"),
  /** Whose island is open. `null` means the player's own island. */
  islandPlayerId: signal<string | null>(null),
});

type TRouteState = ReturnType<typeof createRouteState>;

export type { TPage, TRouteState };
export { createRouteState };
