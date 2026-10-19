// Public surface of `src/datasource`. Lists only names used outside the folder.
// Modules inside the folder import each other by path, never via this index, to avoid cycles.

import { BORDER_PUSH_MS, SAVE_DELAY_MS, createDatasources } from "./datasources";
import type { DatasourceOptions, TDatasources } from "./datasources";

import { STATE_KEY, STORAGE_BUDGET_BYTES, createMemoryStorage } from "./state-storage";
import type { StateStorage, StateWarning, WarningKind } from "./state-storage";

import type { BordersSource, CountryResult } from "./borders-source";
import type { BorderStats } from "./borders-worker";

import { createDebouncer } from "./debouncer";
import type { TimerHandle, Timers } from "./debouncer";

export {
  // composed set
  BORDER_PUSH_MS,
  SAVE_DELAY_MS,
  createDatasources,
  type DatasourceOptions,
  type TDatasources,
  // storage
  STATE_KEY,
  STORAGE_BUDGET_BYTES,
  createMemoryStorage,
  type StateStorage,
  type StateWarning,
  type WarningKind,
  // borders
  type BorderStats,
  type BordersSource,
  type CountryResult,
  // clock
  createDebouncer,
  type TimerHandle,
  type Timers,
};
