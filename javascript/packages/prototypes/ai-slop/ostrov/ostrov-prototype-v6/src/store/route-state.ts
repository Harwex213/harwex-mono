import { signal } from "@preact/signals-react";

/** The four pages of the spec: menu, island, global map, battle. */
type TPage = "menu" | "island" | "world" | "battle";

const createRouteState = () => ({
  page: signal<TPage>("menu"),
  /** Whose island is open. `null` means the player's own island. */
  islandPlayerId: signal<string | null>(null),
});

type TRouteState = ReturnType<typeof createRouteState>;

export type { TPage, TRouteState };
export { createRouteState };
