import { signal } from "@preact/signals-react";
import type { Signal } from "@preact/signals-react";

/**
 * Hash routing, the way `ostrov-prototype-v2-config/src/editor/router.ts` does it:
 * there is no router in the monorepo, and the hash is the whole route, so a deep
 * link, the back button and a nav click all arrive through one `hashchange`.
 *
 * | hash                 | page     | viewedPlayerId |
 * | -------------------- | -------- | -------------- |
 * | `#/`                 | menu     | null           |
 * | `#/island`           | island   | null           |
 * | `#/island/:playerId` | island   | playerId       |
 * | `#/world`            | world    | null           |
 * | `#/battle`           | battle   | null           |
 */

type TPage = "menu" | "island" | "world" | "battle";

/** The parsed hash. `viewedPlayerId` is non-null only on a readonly foreign island. */
type TRoute = {
  readonly page: TPage;
  readonly viewedPlayerId: string | null;
};

type TRouteState = {
  readonly page: Signal<TPage>;
  readonly viewedPlayerId: Signal<string | null>;
};

const MENU_ROUTE: TRoute = { page: "menu", viewedPlayerId: null };

const createRouteState = (): TRouteState => {
  return {
    page: signal<TPage>(MENU_ROUTE.page),
    viewedPlayerId: signal<string | null>(MENU_ROUTE.viewedPlayerId),
  };
};

/** Pure: `#/island/p2` becomes `{ page: "island", viewedPlayerId: "p2" }`. An unknown hash falls back to the menu. */
const parseHash = (hash: string): TRoute => {
  const trimmed = hash.replace(/^#\/?/, "");
  if (trimmed === "") {
    return MENU_ROUTE;
  }

  const segments = trimmed.split("/").map((segment) => decodeURIComponent(segment));
  const head = segments[0];

  if (head === "island") {
    const playerId = segments[1];

    return { page: "island", viewedPlayerId: playerId === undefined || playerId === "" ? null : playerId };
  }

  if (head === "world") {
    return { page: "world", viewedPlayerId: null };
  }

  if (head === "battle") {
    return { page: "battle", viewedPlayerId: null };
  }

  return MENU_ROUTE;
};

/** The inverse of `parseHash`. */
const hashFor = (page: TPage, playerId: string | null): string => {
  if (page === "menu") {
    return "#/";
  }

  if (page === "island" && playerId !== null) {
    return `#/island/${encodeURIComponent(playerId)}`;
  }

  return `#/${page}`;
};

export type { TPage, TRoute, TRouteState };
export { createRouteState, hashFor, parseHash };
