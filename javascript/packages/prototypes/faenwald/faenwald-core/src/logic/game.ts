import type { TGameContext, TGameState } from "../model/game-context.js";
import type { TProvince } from "../model/base/province.js";
import { applyEvent } from "./event/apply-event.js";

export const createGameState = (ctx: TGameContext) => {
  const gameState: TGameState = {
    houses: {},
    provinces: Object.values(ctx.provincesRaw).reduce<Record<string, TProvince>>((map, province) => {
      map[province.provinceId] = {
        ...province,
        turnover: 0,
        supply: 0,
        fortress: 0,
      };

      return map;
    }, {}),
    armies: {},
  };

  for (const turn of ctx.turns) {
    for (const phase of turn.phases) {
      for (const event of phase) {
        applyEvent(gameState, event);
      }
    }
  }

  return gameState;
}

export const getInvalidTurns = (ctx: TGameContext) => {
  for (const turn of ctx.turns) {
    for (const phase of turn.phases) {
      for (const event of phase) {

      }
    }
  }
};

export const validateIsAllTurnsValid = (ctx: TGameContext) => {
  const turns = getInvalidTurns
}

export const assignProvinceSupply = (gameState: TGameState, provinceId: string, supply: number) => {
  const province = gameState.provinces[provinceId];
  if (!province) {
    throw new Error("Game: Province not found");
  }
  province.supply = supply;
  province.turnover = supply * 100_000;
};
