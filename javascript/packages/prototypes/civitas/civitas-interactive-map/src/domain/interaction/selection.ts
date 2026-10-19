// Selection state and its transition table. Pure.

type SelectionScope = "none" | "province" | "country";

type SelectionState = {
  provinceId: number | null;
  // Used only at scope "country". At scope "province" the country is derived
  // live from the owner, so a repaint during a drag updates the plaque.
  countryId: number | null;
  scope: SelectionScope;
};

type SelectionIntent =
  | { kind: "province"; provinceId: number | null }
  | { kind: "countryOfProvince"; provinceId: number | null }
  | { kind: "country"; countryId: number | null }
  | { kind: "clear" };

const EMPTY_SELECTION: SelectionState = { provinceId: null, countryId: null, scope: "none" };

// Decisions:
// - Right-click on an unassigned province selects the province. Clearing would
//   make right-click feel broken over most of the map.
// - A `country` intent keeps the current province only if the country owns it,
//   so the province and the plaque never disagree.
function nextSelection(
  current: SelectionState,
  intent: SelectionIntent,
  ownerOf: ReadonlyMap<number, number>,
): SelectionState {
  if (intent.kind === "clear") {
    return EMPTY_SELECTION;
  }

  if (intent.kind === "province") {
    if (intent.provinceId === null) {
      return EMPTY_SELECTION;
    }
    return { provinceId: intent.provinceId, countryId: null, scope: "province" };
  }

  if (intent.kind === "countryOfProvince") {
    if (intent.provinceId === null) {
      return EMPTY_SELECTION;
    }
    const owner = ownerOf.get(intent.provinceId);
    if (owner === undefined) {
      return { provinceId: intent.provinceId, countryId: null, scope: "province" };
    }
    return { provinceId: intent.provinceId, countryId: owner, scope: "country" };
  }

  if (intent.countryId === null) {
    return {
      provinceId: current.provinceId,
      countryId: null,
      scope: current.provinceId === null ? "none" : "province",
    };
  }

  const kept =
    current.provinceId !== null && ownerOf.get(current.provinceId) === intent.countryId
      ? current.provinceId
      : null;
  return { provinceId: kept, countryId: intent.countryId, scope: "country" };
}

// Lets callers skip a signal write, so re-clicking the selection does not repaint.
function sameSelection(left: SelectionState, right: SelectionState): boolean {
  return (
    left.provinceId === right.provinceId &&
    left.countryId === right.countryId &&
    left.scope === right.scope
  );
}

export {
  EMPTY_SELECTION,
  nextSelection,
  sameSelection,
  type SelectionIntent,
  type SelectionScope,
  type SelectionState,
};
