import type { Registry } from "../registry";
import type { Store } from "../store/types";
import type { ScenarioName } from "./scenario-names";

// A scenario is "the state the app is in when the shutter opens". It gets there
// the same way a user would — by calling registry functions — so a baseline can
// never show a state the app cannot actually reach.
//
// A scenario is allowed to write a signal directly, but only to set up what the
// server would have sent (a balance, a session). Everything a user does goes
// through the registry.

type ScenarioContext = {
  readonly store: Store;
  readonly registry: Registry;
};

type Scenario = {
  readonly title: string;
  readonly setup?: (context: ScenarioContext) => void;
};

const scenarios: Record<ScenarioName, Scenario> = {
  "lobby-default": {
    title: "Fresh lobby, nothing filtered",
  },
  "lobby-search-lightning": {
    title: "Search matches one table",
    setup: ({ registry }) => {
      registry.setQuery("lightning");
    },
  },
  "lobby-category-blackjack": {
    title: "Blackjack tab",
    setup: ({ registry }) => {
      registry.setCategory("blackjack");
    },
  },
  "lobby-provider-filter": {
    title: "Two providers selected",
    setup: ({ registry }) => {
      registry.toggleProvider("evolution");
      registry.toggleProvider("ezugi");
    },
  },
  "lobby-sorted-by-min-bet": {
    title: "Sorted by lowest min bet",
    setup: ({ registry }) => {
      registry.setSort("min-bet");
    },
  },
  "lobby-only-free-seats": {
    title: "Only tables with a free seat",
    setup: ({ registry }) => {
      registry.toggleOnlyAvailable();
    },
  },
  "lobby-favourites-only": {
    title: "Favourites only",
    setup: ({ registry }) => {
      registry.toggleFavourite("crazy-time");
      registry.toggleFavourite("quantum-roulette");
      registry.toggleFavourite("salon-prive-blackjack");
      registry.toggleOnlyFavourites();
    },
  },
  "lobby-no-matches": {
    title: "Search matches nothing",
    setup: ({ registry }) => {
      registry.setQuery("keno");
    },
  },
  "lobby-deep-filter": {
    title: "Category, provider, sort and a selection at once",
    setup: ({ registry }) => {
      registry.setCategory("roulette");
      registry.toggleProvider("evolution");
      registry.toggleProvider("playtech");
      registry.setSort("min-bet");
      registry.selectTable("quantum-roulette");
    },
  },
  "table-selected-roulette": {
    title: "Roulette table open, with results history",
    setup: ({ registry }) => {
      registry.selectTable("lightning-roulette");
    },
  },
  "table-selected-game-show": {
    title: "Game show open, hundreds of seats",
    setup: ({ registry }) => {
      registry.selectTable("crazy-time");
    },
  },
  "table-joined": {
    title: "Seated: balance reserved, seat taken",
    setup: ({ registry }) => {
      registry.joinTable("blackjack-vip-3");
    },
  },
  "join-rejected-full": {
    title: "Join refused: every seat taken",
    setup: ({ registry }) => {
      registry.selectTable("speed-blackjack-12");
      registry.joinTable("speed-blackjack-12");
    },
  },
  "join-rejected-offline": {
    title: "Join refused: studio offline",
    setup: ({ registry }) => {
      registry.setCategory("blackjack");
      registry.selectTable("majority-rules-blackjack");
      registry.joinTable("majority-rules-blackjack");
    },
  },
  "join-rejected-balance": {
    title: "Join refused: balance below the min bet",
    setup: ({ store, registry }) => {
      // Seeded state, not a user action: this is what the wallet endpoint would
      // have returned.
      store.balance.value = 10;
      registry.selectTable("salon-prive-blackjack");
      registry.joinTable("salon-prive-blackjack");
    },
  },
};

export { scenarios };
export type { Scenario, ScenarioContext };
