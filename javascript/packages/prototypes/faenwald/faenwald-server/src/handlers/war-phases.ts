import { ARMY_RANK_TO_MODIFIER, ARMY_UNIT_TEMPLATES, type  TArmy, TArmyUnit, type TWarPhase } from "@hw/faenwald-core";
import { register } from "../core/rpc.js";
import { RpcError } from "../core/error.js";
import { flushWarPhase, loadWarPhase } from "../data-source/data-source.js";
import type {
  TSerializedArmy,
  TSerializedArmyUnit,
  TWarPhaseActionSerialized,
  TWarPhaseSerialized
} from "../data-source/data-source-types.js";

type LoadParams = { turn: number };
type SaveParams = { warPhase: TWarPhase };

register<LoadParams, TWarPhase>("warPhase.load", async (params) => {
  if (typeof params?.turn !== "number") {
    throw new RpcError("INVALID_PARAMS", "\"turn\" must be a number");
  }

  const warPhaseRaw = await loadWarPhase(params.turn);

  const armies = Object.values(warPhaseRaw.armies).reduce<Record<string, TArmy>>((armies, serializedArmy) => {
    armies[serializedArmy.id] = {
      id: serializedArmy.id,
      provinceId: serializedArmy.provinceId,
      units: serializedArmy.units.map((unit) => {
        const unitTemplate = ARMY_UNIT_TEMPLATES[unit.type];
        const unitRankModifier = ARMY_RANK_TO_MODIFIER[unit.rank];

        return {
          kind: unit.kind,
          type: unit.type,
          amount: unit.amount,
          baseHp: unitTemplate.baseHp,
          baseAttack: unitTemplate.baseAttack,
          baseMorale: unitTemplate.baseMorale,
          baseSpeed: unitTemplate.baseSpeed,
          stripes: unit.stripes,
          rank: unit.rank,
          modifiers: [
            unitRankModifier,
            ...unit.modifiers
          ],
          houseId: unit.houseId,
        } satisfies TArmyUnit;
      }),
    } satisfies TArmy;

    return armies;
  }, {});

  const warPhase = {
    phase: warPhaseRaw.phase,
    armies,
    actionRounds: warPhaseRaw.actions,
  } satisfies TWarPhase;

  return warPhase;
});

register<SaveParams, void>("warPhase.save", async (params) => {
  if (!params?.warPhase || typeof params.warPhase.phase !== "number") {
    throw new RpcError("INVALID_PARAMS", "\"warPhase\" with a valid \"phase\" is required");
  }

  const warPhase = params.warPhase;

  const warPhaseRaw = {
    phase: warPhase.phase,
    armies: Object.values(warPhase.armies).reduce<Record<string, TSerializedArmy>>((armies, serializedArmy) => {
      armies[serializedArmy.id] = {
        id: serializedArmy.id,
        provinceId: serializedArmy.provinceId,
        units: serializedArmy.units.map((unit) => {
          const unitRankModifier = ARMY_RANK_TO_MODIFIER[unit.rank];

          return {
            kind: unit.kind,
            type: unit.type,
            amount: unit.amount,
            stripes: unit.stripes,
            rank: unit.rank,
            modifiers: unit.modifiers.filter((modifier) => modifier.id !== unitRankModifier.id),
            houseId: unit.houseId,
          } satisfies TSerializedArmyUnit;
        }),
      } satisfies TSerializedArmy;

      return armies;
    }, {}),
  } satisfies TWarPhaseSerialized;
  const actions = {
    phase: warPhase.phase,
    actions: warPhase.actionRounds,
  } satisfies TWarPhaseActionSerialized;

  await flushWarPhase(warPhase.phase, warPhaseRaw, actions);
});
