import type { BuildingKind, BuildingKindId } from "./building-kind";
import { buildingKinds } from "./building-kind";
import type { Random } from "./random";

const sequence = (values: readonly number[]): Random => {
  let index = 0;

  return () => {
    const value = values[index % values.length] ?? 0;

    index += 1;

    return value;
  };
};

const constant = (value: number): Random => {
  return () => {
    return value;
  };
};

const kindOf = (id: BuildingKindId): BuildingKind => {
  const kind = buildingKinds.find((candidate) => {
    return candidate.id === id;
  });

  if (!kind) {
    throw new Error(`Unknown building ${id}`);
  }

  return kind;
};

export { constant, kindOf, sequence };
