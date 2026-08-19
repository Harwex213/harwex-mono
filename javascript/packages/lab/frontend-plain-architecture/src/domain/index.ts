import type { Store } from "../store/types";
import {
  resetFilters,
  setCategory,
  setQuery,
  setSort,
  toggleOnlyAvailable,
  toggleOnlyFavourites,
  toggleProvider,
} from "./filters";
import {
  closeTable,
  dismissNotice,
  joinTable,
  leaveTable,
  selectTable,
  toggleFavourite,
  topUpBalance,
} from "./session";

// Anything a user can do to this app is one entry in this record. The registry
// binds the record to a store; the `satisfies` clause is what stops a function
// with a different shape from sneaking in.
type DomainFunction = (store: Store, ...input: never[]) => void;

const domainFunctions = {
  setQuery,
  setCategory,
  toggleProvider,
  setSort,
  toggleOnlyAvailable,
  toggleOnlyFavourites,
  resetFilters,
  selectTable,
  closeTable,
  toggleFavourite,
  joinTable,
  leaveTable,
  topUpBalance,
  dismissNotice,
} satisfies Record<string, DomainFunction>;

type DomainFunctions = typeof domainFunctions;

export { domainFunctions };
export type { DomainFunction, DomainFunctions };
