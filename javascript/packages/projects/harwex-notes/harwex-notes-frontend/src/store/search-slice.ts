import { signal } from "@preact/signals-react";

// The content side of a search, as the backend found it on disk (SRCH-5). `term` is the
// term these counts belong to; counts for an older term are never shown with a newer one.
// While a search runs, `countById` holds what has been found so far (SRCH-16).
type TContentSearch =
  | { status: "idle" }
  | { status: "running"; term: string; countById: ReadonlyMap<string, number> }
  | { status: "done"; term: string; countById: ReadonlyMap<string, number> }
  | { status: "error"; term: string; countById: ReadonlyMap<string, number>; message: string };

// The search is a momentary act and not part of the workspace, so nothing here is saved
// or restored on reload (SESS-5).
const createSearchState = () => ({
  // The text in the search field, as typed. An empty term means no search.
  term: signal(""),
  // The filtered tree opens the folders on the path to every match by itself. These two
  // lists hold the reader's own changes on top of that, and both reset with each new term.
  // The reader's expanded folders outside the search live in fs.expandedIds and are never
  // touched by a search (SRCH-3).
  expandedIds: signal<readonly string[]>([]),
  collapsedIds: signal<readonly string[]>([]),
  // The row selected when the search started. Clearing the field selects it again (SRCH-3).
  preSearchSelectedId: signal<string | null>(null),
  content: signal<TContentSearch>({ status: "idle" }),
});

type TSearchSlice = ReturnType<typeof createSearchState>;

export type { TContentSearch, TSearchSlice };
export { createSearchState };
