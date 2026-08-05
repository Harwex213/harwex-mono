import { computed, effect, signal } from "@preact/signals-react";
import { ECONOMY_CONSTANTS, OTHER_SECTOR_KEYS } from "../economy/constants";
import { createInitialEconomy, createSector } from "../economy/economy-state";
import { deriveEconomy } from "../economy/derive";
import { economyFromJson, economyToJson } from "../economy/serialize";
import { resolveTurn } from "../economy/pipeline";
import { selectedCountryId } from "./selection-store";
import {
  countryById,
  economics,
  economicsOf,
  flushState,
  setCountryEconomics,
  statePersistent,
  stateWarning,
} from "./world-store";
import type {
  DerivedEconomy,
  EconomyState,
  LedgerLine,
  Loan,
  ResourceKey,
  ResourceState,
  Sector,
  SectorKey,
  TurnRecord,
  ValidationError,
} from "../economy/types";
import type { CountryEconomics } from "./schema";
import type { ReadonlySignal } from "@preact/signals-react";

// The bridge between the frozen engine in `src/economy/` and T12's panel. It
// hydrates, holds, derives, writes through, and resolves a turn.
//
// WHY A STORE AT ALL — three problems the panel cannot solve on its own:
//
// 1. `economyFromJson` is a REPAIRING reader. Round-tripping through JSON on
//    every keystroke would let the reader silently rewrite a half-typed value, so
//    the hydrated `EconomyState` is held in memory and is the live truth for the
//    session.
// 2. `deriveEconomy` must run once per change, not once per readout. A `computed`
//    memoises it.
// 3. `setCountryEconomics` silently no-ops for an unknown country id, and
//    `sanitizeRecord` DROPS a NaN key. One guarded writer keeps that from being a
//    hazard scattered across eleven components.

type EconomySlot = {
  countryId: number;
  state: EconomyState;
  repairs: readonly string[];
};

type LedgerListKey =
  | "frExpenseLines"
  | "micExpenseLines"
  | "frIncomeLines"
  | "micIncomeLines";

type TurnOutcome =
  | { ok: true; countryId: number; turn: number; record: TurnRecord; saved: boolean }
  | { ok: false; countryId: number; turn: number; errors: readonly ValidationError[] };

const draftsSignal = signal<Map<number, EconomyState>>(new Map());
const judgeSignal = signal(false);
const outcomeSignal = signal<TurnOutcome | null>(null);

// `economyFromJson` never throws and always returns a usable state, so there is
// no failure branch to handle.
function hydrateEconomy(slot: CountryEconomics | null): {
  state: EconomyState;
  repairs: string[];
} {
  if (slot === null) {
    return { state: createInitialEconomy(), repairs: [] };
  }
  return economyFromJson(slot.data);
}

const judgeMode: ReadonlySignal<boolean> = computed(() => {
  return judgeSignal.value;
});

const lastTurnOutcome: ReadonlySignal<TurnOutcome | null> = computed(() => {
  return outcomeSignal.value;
});

// Three properties of this shape are load bearing:
//
// - NO SIGNAL IS WRITTEN DURING RENDER. Hydration is a pure function inside a
//   `computed`. An effect that hydrated into a signal would fire during a render
//   pass, which is the classic way to get an infinite loop here.
// - Once a draft exists the computed stops subscribing to `economics`, because
//   `computed` tracks dynamically. After the first edit, another country's save
//   does not re-hydrate this one.
// - A country the user only LOOKS AT is never written. Nothing lands in
//   `civitas.state.v1` until the first edit or End Turn, so a 60-country document
//   does not gain 60 economies nobody touched.
const selectedEconomy: ReadonlySignal<EconomySlot | null> = computed(() => {
  const id = selectedCountryId.value;
  if (id === null) {
    return null;
  }
  const draft = draftsSignal.value.get(id);
  if (draft !== undefined) {
    return { countryId: id, state: draft, repairs: [] };
  }
  const slot = economics.value.get(id) ?? null;
  const hydrated = hydrateEconomy(slot);
  return { countryId: id, state: hydrated.state, repairs: hydrated.repairs };
});

// `provinceCount` feeds spec 15.3's concession cost (`gdpTotal / provinceCount`).
// Reading `countryById` subscribes the panel to province painting, which is
// correct: painting a province changes what a concession costs. `deriveEconomy`
// is total and never throws, so this stays safe while a field is momentarily out
// of range.
const selectedDerived: ReadonlySignal<DerivedEconomy | null> = computed(() => {
  const slot = selectedEconomy.value;
  if (slot === null) {
    return null;
  }
  const country = countryById.value.get(slot.countryId) ?? null;
  const provinceCount = country === null ? 0 : country.provinceIds.length;
  return deriveEconomy(slot.state, { provinceCount });
});

function provinceCountOf(countryId: number): number {
  const country = countryById.peek().get(countryId) ?? null;
  return country === null ? 0 : country.provinceIds.length;
}

// `.peek()`, never `.value` — every reader below runs inside an event handler and
// must not subscribe anything to anything.
//
// The selected country reads through `selectedEconomy.peek()`, which returns the
// memoised object the panel is rendering. Hydrating a second time here would
// produce an equal but DIFFERENT object, and every untouched array inside it
// would lose its identity on the first edit — which re-renders the whole sheet
// instead of the one row that changed.
function currentEconomy(countryId: number): EconomyState {
  const selected = selectedEconomy.peek();
  if (selected !== null && selected.countryId === countryId) {
    return selected.state;
  }
  const draft = draftsSignal.peek().get(countryId);
  if (draft !== undefined) {
    return draft;
  }
  return hydrateEconomy(economicsOf(countryId)).state;
}

// THE SINGLE WRITER. Write-through is synchronous and there is no second
// debounce: `setCountryEconomics` calls `markDirty`, the T05 writer already
// coalesces the localStorage write at 400 ms, and the inputs above are already
// buffered at 200 ms by `useFieldCommit`. A second debounce here would only add a
// window in which a closing panel loses the last edit.
function commitEconomy(countryId: number, next: EconomyState): void {
  if (!countryById.peek().has(countryId)) {
    return;
  }
  const drafts = new Map(draftsSignal.value);
  drafts.set(countryId, next);
  draftsSignal.value = drafts;
  setCountryEconomics(countryId, economyToJson(next));
}

function setJudgeMode(on: boolean): void {
  if (judgeSignal.value === on) {
    return;
  }
  judgeSignal.value = on;
}

function toggleJudgeMode(): void {
  judgeSignal.value = !judgeSignal.value;
}

function updateEconomy(countryId: number, mutate: (current: EconomyState) => EconomyState): void {
  commitEconomy(countryId, mutate(currentEconomy(countryId)));
}

// Every collection helper REPLACES its array rather than mutating it. The T05
// rule: a mutated array is `Object.is`-equal to itself and nothing re-renders.
function updateSector(countryId: number, key: SectorKey, patch: Partial<Sector>): void {
  updateEconomy(countryId, (current) => {
    return {
      ...current,
      sectors: current.sectors.map((sector) => {
        return sector.key === key ? { ...sector, ...patch } : sector;
      }),
    };
  });
}

function updateResource(
  countryId: number,
  key: ResourceKey,
  patch: Partial<ResourceState>,
): void {
  updateEconomy(countryId, (current) => {
    return {
      ...current,
      resources: current.resources.map((resource) => {
        return resource.key === key ? { ...resource, ...patch } : resource;
      }),
    };
  });
}

function updateLoan(countryId: number, loanId: number, patch: Partial<Loan>): void {
  updateEconomy(countryId, (current) => {
    return {
      ...current,
      loans: current.loans.map((loan) => {
        return loan.id === loanId ? { ...loan, ...patch } : loan;
      }),
    };
  });
}

function setLedgerLines(
  countryId: number,
  list: LedgerListKey,
  lines: readonly LedgerLine[],
): void {
  updateEconomy(countryId, (current) => {
    return {
      ...current,
      [list]: lines.slice(0, ECONOMY_CONSTANTS.LEDGER_LINE_MAX).map((line) => {
        return { ...line };
      }),
    };
  });
}

function clearLedgerLines(countryId: number): void {
  updateEconomy(countryId, (current) => {
    return {
      ...current,
      frExpenseLines: [],
      micExpenseLines: [],
      frIncomeLines: [],
      micIncomeLines: [],
    };
  });
}

// Spec 4.1 makes an Other sector without grounds illegal (V10), so the store
// REFUSES to create one rather than creating an invalid state the panel then has
// to explain.
function addOtherSector(countryId: number, name: string, grounds: string): void {
  const trimmedGrounds = grounds.trim();
  if (trimmedGrounds === "") {
    return;
  }
  const current = currentEconomy(countryId);
  let free: SectorKey | null = null;
  for (const key of OTHER_SECTOR_KEYS) {
    const taken = current.sectors.some((sector) => {
      return sector.key === key;
    });
    if (!taken) {
      free = key;
      break;
    }
  }
  if (free === null) {
    return;
  }
  const trimmedName = name.trim();
  const sector: Sector = {
    ...createSector(free),
    name: trimmedName === ""
      ? createSector(free).name
      : trimmedName.slice(0, ECONOMY_CONSTANTS.SECTOR_NAME_MAX),
    grounds: trimmedGrounds.slice(0, ECONOMY_CONSTANTS.SECTOR_GROUNDS_MAX),
    // A new sector starts empty: a volume is a [V] the judge sets afterwards, and
    // inventing 20 million obor of GDP here would be a formula in the UI layer.
    gdpObor: 0,
  };
  commitEconomy(countryId, { ...current, sectors: [...current.sectors, sector] });
}

function removeOtherSector(countryId: number, key: SectorKey): void {
  if (!OTHER_SECTOR_KEYS.includes(key)) {
    return;
  }
  updateEconomy(countryId, (current) => {
    return {
      ...current,
      sectors: current.sectors.filter((sector) => {
        return sector.key !== key;
      }),
      // A pending concession naming the removed sector would raise V11 on every
      // later turn with no field left to point at.
      pendingConcession: current.pendingConcession !== null
        && current.pendingConcession.sectorKey === key
        ? null
        : current.pendingConcession,
    };
  });
}

// `flushState` is called HERE and nowhere else in T12. An End Turn that did not
// reach disk is data loss, and discovering it 400 ms later reads as "it worked,
// then a banner appeared". A keystroke never flushes.
function endEconomyTurn(countryId: number): TurnOutcome {
  const state = currentEconomy(countryId);
  const turn = state.turn;
  const result = resolveTurn(state, { provinceCount: provinceCountOf(countryId) });

  if (!result.ok) {
    // NOTHING is written. The engine guarantees it and this store relies on it.
    const failure: TurnOutcome = { ok: false, countryId, turn, errors: result.errors };
    outcomeSignal.value = failure;
    return failure;
  }

  commitEconomy(countryId, result.next);
  flushState();
  const warning = stateWarning.peek();
  const saved = statePersistent.peek() && warning?.kind !== "quota";
  const success: TurnOutcome = {
    ok: true,
    countryId,
    turn: result.record.turn,
    record: result.record,
    saved,
  };
  outcomeSignal.value = success;
  return success;
}

function dismissTurnOutcome(): void {
  if (outcomeSignal.value === null) {
    return;
  }
  outcomeSignal.value = null;
}

// `deleteCountry` already removes the `economics` slot but knows nothing about
// this map. Ids are never reused inside a session (`nextCountryId` only
// increases) and the map is empty after a reload, so a stale draft is currently
// unreachable — but "unreachable" rests on a counter in another file, and ten
// lines removes the dependency. `peek()` on the drafts, so the effect does not
// re-trigger on its own write.
function initEconomySync(): () => void {
  return effect(() => {
    const live = countryById.value;
    const drafts = draftsSignal.peek();
    if (drafts.size === 0) {
      return;
    }
    let removed = false;
    const kept = new Map<number, EconomyState>();
    for (const [id, state] of drafts) {
      if (live.has(id)) {
        kept.set(id, state);
        continue;
      }
      removed = true;
    }
    if (!removed) {
      return;
    }
    draftsSignal.value = kept;
  });
}

// A test seam, and the reason judge mode is not persisted: it is view state, not
// world state, so `civitas.state.v1` gains no key from T12. Judge mode resets to
// off on every reload, which is the safe default — a player reloading the page
// cannot inherit a judge's unlocked sheet.
function resetEconomyStore(): void {
  draftsSignal.value = new Map();
  judgeSignal.value = false;
  outcomeSignal.value = null;
}

export {
  addOtherSector,
  clearLedgerLines,
  dismissTurnOutcome,
  endEconomyTurn,
  hydrateEconomy,
  initEconomySync,
  judgeMode,
  lastTurnOutcome,
  removeOtherSector,
  resetEconomyStore,
  selectedDerived,
  selectedEconomy,
  setJudgeMode,
  setLedgerLines,
  toggleJudgeMode,
  updateEconomy,
  updateLoan,
  updateResource,
  updateSector,
  type EconomySlot,
  type LedgerListKey,
  type TurnOutcome,
};
