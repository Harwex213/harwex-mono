type StrokeAction = "assign" | "erase";

// Brush rule: Alt erases, a province of the active country toggles off,
// anything else is assigned to the active country.
function strokeActionFor(
  provinceId: number | null,
  countryId: number,
  ownerOf: ReadonlyMap<number, number>,
  altKey: boolean,
): StrokeAction {
  if (altKey) {
    return "erase";
  }
  if (provinceId !== null && ownerOf.get(provinceId) === countryId) {
    return "erase";
  }
  return "assign";
}

export { strokeActionFor, type StrokeAction };
