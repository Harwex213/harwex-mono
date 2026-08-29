import { ROSTER_LIMIT, createUnit, rollShopOffers } from "../game/roster";
import { archetypeOf } from "../battle/archetypes";
import { pushLog } from "./log-actions";
import type { TStore } from "../../store/store";

/** Price of one shop refresh. */
const REROLL_COST = 2;

const rerollShopAction = (store: TStore): void => {
  if (store.metaState.phase.peek() !== "prep") {
    return;
  }

  const gold = store.metaState.gold.peek();
  if (gold < REROLL_COST) {
    return;
  }

  store.metaState.gold.value = gold - REROLL_COST;
  store.shopState.offers.value = rollShopOffers(store.rng);
};

const buyUnitAction = (store: TStore, offerIndex: number): void => {
  if (store.metaState.phase.peek() !== "prep") {
    return;
  }

  const offers = store.shopState.offers.peek();
  const archetypeId = offers[offerIndex];
  if (archetypeId === undefined) {
    return;
  }

  const roster = store.rosterState.player.peek();
  if (roster.length >= ROSTER_LIMIT) {
    pushLog(store, "Отряд полон — сначала продайте кого-нибудь");

    return;
  }

  const archetype = archetypeOf(archetypeId);
  const gold = store.metaState.gold.peek();
  if (gold < archetype.cost) {
    return;
  }

  const unit = createUnit(store.rng, roster, archetypeId, "player");
  store.metaState.gold.value = gold - archetype.cost;
  store.rosterState.player.value = [...roster, unit];
  store.shopState.offers.value = offers.filter((_offer, index) => index !== offerIndex);
  store.rosterState.selectedId.value = unit.id;
  pushLog(store, `${archetype.name} нанят за ${archetype.cost} з.`);
};

const sellUnitAction = (store: TStore, unitId: string): void => {
  if (store.metaState.phase.peek() !== "prep") {
    return;
  }

  const roster = store.rosterState.player.peek();
  const unit = roster.find((candidate) => candidate.id === unitId);
  if (!unit) {
    return;
  }

  const archetype = archetypeOf(unit.archetypeId);
  const refund = Math.max(1, archetype.cost - 1);
  store.metaState.gold.value = store.metaState.gold.peek() + refund;
  store.rosterState.player.value = roster.filter((candidate) => candidate.id !== unitId);

  if (store.rosterState.selectedId.peek() === unitId) {
    store.rosterState.selectedId.value = null;
  }

  pushLog(store, `${archetype.name} распущен, вернулось ${refund} з.`);
};

export { REROLL_COST, buyUnitAction, rerollShopAction, sellUnitAction };
