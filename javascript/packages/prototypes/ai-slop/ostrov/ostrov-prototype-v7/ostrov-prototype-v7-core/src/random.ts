type Random = () => number;

const pick = <T>(random: Random, items: readonly T[]): T => {
  const index = Math.min(items.length - 1, Math.floor(random() * items.length));
  const item = items[index];

  if (item === undefined) {
    throw new Error("Cannot pick from an empty list");
  }

  return item;
};

const chance = (random: Random, probability: number): boolean => {
  return random() < probability;
};

export { chance, pick };
export type { Random };
