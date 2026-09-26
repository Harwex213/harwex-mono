type TrailEventId = "bandits" | "undead" | "madness" | "worm";

type TrailEvent = {
  id: TrailEventId;
  title: string;
  threshold: number;
  chance: number;
  power: number;
};

const trailEvents: readonly TrailEvent[] = [
  { id: "bandits", title: "налёт бандитов", threshold: 20, chance: 0.25, power: 4 },
  { id: "undead", title: "налёт нечисти", threshold: 40, chance: 0.2, power: 6 },
  { id: "madness", title: "вспышка безумия", threshold: 30, chance: 0.3, power: 3 },
  { id: "worm", title: "мусорный червь", threshold: 60, chance: 0.15, power: 10 },
];

export { trailEvents };
export type { TrailEvent, TrailEventId };
