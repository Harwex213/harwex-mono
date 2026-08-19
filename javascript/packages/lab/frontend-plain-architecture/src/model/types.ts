// The shared vocabulary of the app. Every layer imports these types, and this
// module imports nothing — that is what keeps the layer graph acyclic while the
// store, the domain and the UI all talk about the same entities.

type TableId = string;
type ProviderId = string;

type GameCategory = "roulette" | "blackjack" | "baccarat" | "game-show";

type TableStatus = "open" | "full" | "offline";

type CategoryFilter = GameCategory | "all";

type SortKey = "popularity" | "min-bet" | "name";

type NoticeKind = "success" | "error" | "info";

type Provider = {
  readonly id: ProviderId;
  readonly name: string;
  readonly accent: string;
};

type LiveTable = {
  readonly id: TableId;
  readonly name: string;
  readonly providerId: ProviderId;
  readonly category: GameCategory;
  readonly status: TableStatus;
  readonly dealer: string;
  readonly seats: number;
  readonly seatsTaken: number;
  readonly watching: number;
  readonly minBet: number;
  readonly maxBet: number;
  readonly popularity: number;
  readonly languages: readonly string[];
  readonly hd: boolean;
  // Last results, newest first. Roulette tables carry numbers, the other
  // categories carry an empty list.
  readonly history: readonly number[];
};

type LobbyFilters = {
  readonly query: string;
  readonly category: CategoryFilter;
  readonly providerIds: readonly ProviderId[];
  readonly onlyAvailable: boolean;
  readonly onlyFavourites: boolean;
  readonly sort: SortKey;
};

type LobbyStats = {
  readonly total: number;
  readonly available: number;
  readonly seatsFree: number;
  readonly averageMinBet: number;
};

type ProviderFacet = {
  readonly provider: Provider;
  readonly total: number;
  readonly available: number;
};

type Notice = {
  readonly kind: NoticeKind;
  readonly text: string;
};

export type {
  CategoryFilter,
  GameCategory,
  LiveTable,
  LobbyFilters,
  LobbyStats,
  Notice,
  NoticeKind,
  Provider,
  ProviderFacet,
  ProviderId,
  SortKey,
  TableId,
  TableStatus,
};
