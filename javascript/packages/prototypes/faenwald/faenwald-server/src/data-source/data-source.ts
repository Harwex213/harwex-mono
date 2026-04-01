import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TGameTurn, TProvincesMap } from "@hw/faenwald-core";
import type { TGameTurnSerialized, TProvinceSerialized } from "./data-source-types.js";

const BASE_PATH = path.join(import.meta.dirname, "..");
const PATH = {
  PROVINCES: path.join(BASE_PATH, "data/provinces.json"),
  turn: (turn: number) => path.join(BASE_PATH, `data/game/${turn}-turn.json`),
};

const loadGameTurn = async (turn: number): Promise<TGameTurn> => {
  const provincesJSON = await fs.readFile(PATH.PROVINCES, "utf-8");
  const turnJSON = await fs.readFile(PATH.turn(turn), "utf-8");

  const turnSerialized = JSON.parse(turnJSON) as TGameTurnSerialized;

  if (turn !== turnSerialized.turn) {
    throw new Error("Game: Loaded turn not matches with requested");
  }

  const provincesRaw = JSON.parse(provincesJSON) as Record<string, TProvinceSerialized>;

  const provinces = Object.values(provincesRaw).reduce<TProvincesMap>((map, province) => {
    map[province.provinceId] = {
      ...province,
      supply: turnSerialized.supplies[province.provinceId] ?? 0,
      fortress: turnSerialized.fortresses[province.provinceId] ?? 0,
    };

    return map;
  }, {});

  return {
    turn,
    provinces,
    houses: turnSerialized.houses,
  };
};

const flushGameTurn = async (gameTurn: TGameTurn): Promise<void> => {
  const gameTurnSerialized = {
    turn: gameTurn.turn,
    houses: gameTurn.houses,
    supplies: Object.values(gameTurn.provinces).reduce<Record<string, number>>((map, province) => {
      map[province.provinceId] = province.supply;
      return map;
    }, {}),
    fortresses: Object.values(gameTurn.provinces).reduce<Record<string, number>>((map, province) => {
      map[province.provinceId] = province.fortress;
      return map;
    }, {}),
  }

  await fs.writeFile(PATH.turn(gameTurn.turn), JSON.stringify(gameTurnSerialized, null, 2), "utf-8");
}

export {
  loadGameTurn,
  flushGameTurn,
}