// The names live in their own module so the Playwright spec can import the list
// in Node without pulling in signals, React or the DOM.

const SCENARIO_NAMES = [
  "lobby-default",
  "lobby-search-lightning",
  "lobby-category-blackjack",
  "lobby-provider-filter",
  "lobby-sorted-by-min-bet",
  "lobby-only-free-seats",
  "lobby-favourites-only",
  "lobby-no-matches",
  "lobby-deep-filter",
  "table-selected-roulette",
  "table-selected-game-show",
  "table-joined",
  "join-rejected-full",
  "join-rejected-offline",
  "join-rejected-balance",
] as const;

type ScenarioName = (typeof SCENARIO_NAMES)[number];

export { SCENARIO_NAMES };
export type { ScenarioName };
