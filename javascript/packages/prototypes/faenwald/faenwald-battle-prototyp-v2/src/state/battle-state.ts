import { computed, signal } from "@preact/signals-react";

type Side = "attacker" | "defender";

type Unit = {
  id: string;
  name: string;
  side: Side;
  hp: number;
  maxHp: number;
};

const units = signal<Unit[]>([
  { id: "u1", name: "Spearmen", side: "attacker", hp: 40, maxHp: 40 },
  { id: "u2", name: "Archers", side: "attacker", hp: 25, maxHp: 25 },
  { id: "u3", name: "Militia", side: "defender", hp: 30, maxHp: 30 },
  { id: "u4", name: "Knights", side: "defender", hp: 50, maxHp: 50 },
]);

const round = signal(1);
const selectedUnitId = signal<string | null>(null);

const selectedUnit = computed(() => {
  const id = selectedUnitId.value;
  if (id === null) {
    return null;
  }
  return units.value.find((unit) => unit.id === id) ?? null;
});

const attackerHp = computed(() => sideHp("attacker"));
const defenderHp = computed(() => sideHp("defender"));

function sideHp(side: Side): number {
  return units.value
    .filter((unit) => unit.side === side)
    .reduce((total, unit) => total + unit.hp, 0);
}

function selectUnit(id: string): void {
  selectedUnitId.value = selectedUnitId.value === id ? null : id;
}

function damageUnit(id: string, amount: number): void {
  units.value = units.value.map((unit) => {
    if (unit.id !== id) {
      return unit;
    }
    return { ...unit, hp: Math.max(0, unit.hp - amount) };
  });
}

function nextRound(): void {
  round.value += 1;
}

export {
  attackerHp,
  damageUnit,
  defenderHp,
  nextRound,
  round,
  selectedUnit,
  selectedUnitId,
  selectUnit,
  units,
  type Side,
  type Unit,
};
