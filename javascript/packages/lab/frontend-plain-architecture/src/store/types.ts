import type { ReadonlySignal, Signal } from "@preact/signals-react";
import type {
  CategoryFilter,
  LiveTable,
  LobbyFilters,
  LobbyStats,
  Notice,
  Provider,
  ProviderFacet,
  ProviderId,
  SortKey,
  TableId,
} from "../model/types";

// Layer 2: store. Writable signals hold every piece of state the app has;
// computed signals hold everything that can be derived from them. Nothing else
// in the app keeps state — no `useState`, no module-level variable.

type Store = {
  // --- sources: what the api layer will fill in one day ---
  readonly providers: Signal<readonly Provider[]>;
  readonly tables: Signal<readonly LiveTable[]>;

  // --- lobby filters ---
  readonly query: Signal<string>;
  readonly category: Signal<CategoryFilter>;
  readonly selectedProviderIds: Signal<readonly ProviderId[]>;
  readonly sort: Signal<SortKey>;
  readonly onlyAvailable: Signal<boolean>;
  readonly onlyFavourites: Signal<boolean>;

  // --- player session ---
  readonly balance: Signal<number>;
  readonly favouriteIds: Signal<readonly TableId[]>;
  readonly selectedTableId: Signal<TableId | null>;
  readonly joinedTableId: Signal<TableId | null>;
  readonly recentlyPlayedIds: Signal<readonly TableId[]>;
  readonly notice: Signal<Notice | null>;

  // --- derived ---
  readonly filters: ReadonlySignal<LobbyFilters>;
  readonly visibleTables: ReadonlySignal<readonly LiveTable[]>;
  readonly selectedTable: ReadonlySignal<LiveTable | null>;
  readonly joinedTable: ReadonlySignal<LiveTable | null>;
  readonly recentlyPlayed: ReadonlySignal<readonly LiveTable[]>;
  readonly stats: ReadonlySignal<LobbyStats>;
  readonly providerFacets: ReadonlySignal<readonly ProviderFacet[]>;
  readonly providerById: ReadonlySignal<ReadonlyMap<ProviderId, Provider>>;
  readonly categoryCounts: ReadonlySignal<ReadonlyMap<CategoryFilter, number>>;
  readonly hasActiveFilters: ReadonlySignal<boolean>;
};

type StoreSeed = {
  readonly providers: readonly Provider[];
  readonly tables: readonly LiveTable[];
  readonly balance: number;
};

export type { Store, StoreSeed };
