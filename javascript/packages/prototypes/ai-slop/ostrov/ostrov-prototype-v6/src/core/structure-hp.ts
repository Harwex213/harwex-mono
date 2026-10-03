import type { THex, TPlayer, TBuildingId } from "./types";

/**
 * Hit points of what stands on a hex: a building or the stronghold. Monsters
 * of the cleanup phase attack them, and the battle is lost when none is left
 * standing.
 *
 * - A building that falls in battle is razed: the hex is empty after the battle.
 * - The stronghold that falls becomes ruins at 0 hp. Ruins roll no die and pay
 *   no power until they are repaired above 0.
 * - At the end of every turn each damaged structure regains 25% of its max hp
 *   for free. A stronghold ruined in this turn's battle is skipped once, so it
 *   misses one full turn of income.
 */

type TStructureKind = TBuildingId | "stronghold";

const BUILDING_MAX_HP: Readonly<Record<TBuildingId, number>> = {
  farm: 120,
  sawmill: 140,
  village: 150,
  observatory: 160,
  university: 170,
  mine: 180,
  masons_guild: 200,
};

const STRONGHOLD_MAX_HP = 600;
const REPAIR_SHARE_PER_TURN = 0.25;

/** The stronghold also shoots: its bolt in the cleanup phase. */
const STRONGHOLD_DEFENSE = {
  damage: 14,
  cooldown: 1.3,
  /** Hex steps. */
  range: 4,
} as const;

const structureKind = (player: TPlayer | null, hex: THex): TStructureKind | null => {
  if (player && player.strongholdHexId === hex.id) {
    return "stronghold";
  }

  return hex.building;
};

const structureMaxHp = (kind: TStructureKind) => {
  return kind === "stronghold" ? STRONGHOLD_MAX_HP : BUILDING_MAX_HP[kind];
};

/** Current hp of what stands on the hex, or `null` for an empty hex. */
const structureHp = (player: TPlayer | null, hex: THex) => {
  const kind = structureKind(player, hex);
  if (!kind) {
    return null;
  }

  const max = structureMaxHp(kind);
  const hp = hex.damaged && hex.damaged.kind === kind ? hex.damaged.hp : max;

  return { kind, hp, max };
};

const isRuinedStronghold = (player: TPlayer | null, hex: THex) => {
  const state = structureHp(player, hex);

  return state !== null && state.kind === "stronghold" && state.hp <= 0;
};

/** The hex with its structure at `hp`. Full health drops the field again. */
const withStructureHp = (hex: THex, kind: TStructureKind, hp: number): THex => {
  const max = structureMaxHp(kind);
  const { damaged: _old, ...rest } = hex;

  return hp >= max ? rest : { ...rest, damaged: { kind, hp: Math.max(0, Math.round(hp)) } };
};

/** The free repair at the end of a turn. `skipHexIds` are ruins made this turn. */
const repairIsland = (player: TPlayer, skipHexIds: ReadonlySet<string>): readonly THex[] => {
  return player.island.hexes.map((hex) => {
    const state = structureHp(player, hex);
    if (!state || state.hp >= state.max || skipHexIds.has(hex.id)) {
      return hex;
    }

    return withStructureHp(hex, state.kind, state.hp + state.max * REPAIR_SHARE_PER_TURN);
  });
};

export type { TStructureKind };
export {
  BUILDING_MAX_HP,
  isRuinedStronghold,
  repairIsland,
  STRONGHOLD_DEFENSE,
  STRONGHOLD_MAX_HP,
  structureHp,
  structureMaxHp,
  withStructureHp,
};
