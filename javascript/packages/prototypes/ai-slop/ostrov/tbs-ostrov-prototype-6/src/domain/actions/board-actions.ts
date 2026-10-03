import { archetypeOf } from "../battle/archetypes";
import { clampToArena, zoneAt } from "../arena/arena";
import { findSpot } from "../game/roster";
import { pushLog } from "./log-actions";
import type { TRosterUnit } from "../battle/types";
import type { TStore } from "../../store/store";

const selectUnitAction = (store: TStore, unitId: string | null): void => {
  store.rosterState.selectedId.value = unitId;
};

const hoverUnitAction = (store: TStore, unitId: string | null): void => {
  if (store.viewState.hoveredId.peek() === unitId) {
    return;
  }

  store.viewState.hoveredId.value = unitId;
};

const beginDragAction = (store: TStore, unitId: string): void => {
  if (store.metaState.phase.peek() !== "prep") {
    return;
  }

  const unit = store.rosterState.player.peek().find((candidate) => candidate.id === unitId);
  if (!unit) {
    return;
  }

  store.viewState.draggingId.value = unitId;
  store.viewState.dragOriginX.value = unit.x;
  store.viewState.dragOriginY.value = unit.y;
  store.viewState.dragValid.value = true;
  store.rosterState.selectedId.value = unitId;
};

/** Units are not snapped to tiles: the pointer position is the position. */
const dragToAction = (store: TStore, x: number, y: number): void => {
  const unitId = store.viewState.draggingId.peek();
  if (unitId === null) {
    return;
  }

  const roster = store.rosterState.player.peek();
  const unit = roster.find((candidate) => candidate.id === unitId);
  if (!unit) {
    return;
  }

  const radius = archetypeOf(unit.archetypeId).radius;
  const spot = clampToArena(x, y, radius);
  store.viewState.dragValid.value = zoneAt(spot.y) === "player";
  store.rosterState.player.value = roster.map((candidate) => {
    if (candidate.id !== unitId) {
      return candidate;
    }

    return { ...candidate, x: spot.x, y: spot.y };
  });
};

const endDragAction = (store: TStore): void => {
  const unitId = store.viewState.draggingId.peek();
  if (unitId === null) {
    return;
  }

  store.viewState.draggingId.value = null;

  if (store.viewState.dragValid.peek()) {
    return;
  }

  const originX = store.viewState.dragOriginX.peek();
  const originY = store.viewState.dragOriginY.peek();
  store.rosterState.player.value = store.rosterState.player.peek().map((candidate) => {
    if (candidate.id !== unitId) {
      return candidate;
    }

    return { ...candidate, x: originX, y: originY };
  });
  store.viewState.dragValid.value = true;
};

/** Scatters the whole squad over its half again, keeping bodies apart. */
const autoArrangeAction = (store: TStore): void => {
  if (store.metaState.phase.peek() !== "prep") {
    return;
  }

  const placed: TRosterUnit[] = [];
  for (const unit of store.rosterState.player.peek()) {
    const spot = findSpot(store.rng, placed, "player", archetypeOf(unit.archetypeId).radius);
    placed.push({ ...unit, x: spot.x, y: spot.y });
  }

  store.rosterState.player.value = placed;
  pushLog(store, "Отряд перестроен");
};

export { autoArrangeAction, beginDragAction, dragToAction, endDragAction, hoverUnitAction, selectUnitAction };
