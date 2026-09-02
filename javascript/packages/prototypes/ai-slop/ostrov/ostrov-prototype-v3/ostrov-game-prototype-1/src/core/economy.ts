import { BUILDING_DEFS } from "./catalog";
import { buildingsOf, isBuilt, log, unitsOnTile } from "./entities";
import { PLAYERS_FACTION_ID } from "./factions";
import { isKnown, TECH_BY_ID } from "./tech";
import type { TGame, TPlayerId, TPlayerState } from "./state";

/** Food a housing block eats to grow one citizen. */
const HOUSING_FOOD = 3;

/** Citizens per extra point of production. */
const CITIZENS_PER_PRODUCTION = 4;

type TIncome = {
  production: number;
  food: number;
  metals: number;
  population: number;
  science: number;
};

const emptyIncome = (): TIncome => ({ production: 0, food: 0, metals: 0, population: 0, science: 0 });

/** What the player's buildings would bring in this turn. Pure: the UI shows it as a forecast. */
const forecastIncome = (game: TGame, player: TPlayerId): TIncome => {
  const state = game.players[player];
  const income = emptyIncome();
  const mineBonus = isKnown(game.research, "metallurgy") ? 1 : 0;
  const workshopBonus = isKnown(game.research, "engineering") ? 1 : 0;
  const labBonus = isKnown(game.research, "electricity") ? 2 : 0;
  let foodLeft = state.food;

  for (const building of buildingsOf(game, PLAYERS_FACTION_ID)) {
    if (building.owner !== player || !isBuilt(building)) {
      continue;
    }

    const def = BUILDING_DEFS[building.type];
    const tile = game.tiles[building.tileId]!;

    switch (building.type) {
      case "power": {
        income.production += 2;
        income.food += 2;
        income.science += 1;
        break;
      }
      case "workshop":
      case "farm":
      case "mine": {
        if (tile.deposits <= 0) {
          break;
        }

        const bonus = building.type === "mine" ? mineBonus : building.type === "workshop" ? workshopBonus : 0;
        income[def.yields!] += def.yieldAmount + bonus;
        break;
      }
      case "housing": {
        if (foodLeft >= HOUSING_FOOD) {
          foodLeft -= HOUSING_FOOD;
          income.food -= HOUSING_FOOD;
          income.population += 1;
        }
        break;
      }
      case "lab": {
        income.science += 2 + labBonus;
        break;
      }
      default: {
        break;
      }
    }
  }

  income.production += Math.floor(state.population / CITIZENS_PER_PRODUCTION);

  return income;
};

const applyIncome = (state: TPlayerState, income: TIncome) => {
  state.production += income.production;
  state.food = Math.max(0, state.food + income.food);
  state.metals += income.metals;
  state.population += income.population;
};

/** Extraction buildings burn a fossil for every yield they made. */
const burnDeposits = (game: TGame, player: TPlayerId) => {
  for (const building of buildingsOf(game, PLAYERS_FACTION_ID)) {
    if (building.owner !== player || !isBuilt(building) || !BUILDING_DEFS[building.type].burnsDeposits) {
      continue;
    }

    const tile = game.tiles[building.tileId]!;
    if (tile.deposits > 0) {
      tile.deposits -= 1;

      if (tile.deposits === 0) {
        log(game, `${BUILDING_DEFS[building.type].name} ${game.players[player].name}: ископаемые гекса истощены.`, "bad");
      }
    }
  }
};

/** Construction sites with a builders unit on them draw from the owner's production. */
const advanceConstruction = (game: TGame, player: TPlayerId): string[] => {
  const state = game.players[player];
  const lines: string[] = [];

  for (const building of buildingsOf(game, PLAYERS_FACTION_ID)) {
    if (building.owner !== player || isBuilt(building) || building.type === "engine") {
      continue;
    }

    const builders = unitsOnTile(game, building.tileId).some((unit) => unit.type === "builders" && unit.factionId === PLAYERS_FACTION_ID);
    if (!builders) {
      continue;
    }

    const paid = Math.min(state.production, building.cost - building.progress);
    if (paid <= 0) {
      continue;
    }

    state.production -= paid;
    building.progress += paid;

    if (isBuilt(building)) {
      const text = `${state.name}: стройка завершена — ${BUILDING_DEFS[building.type].name}.`;
      lines.push(text);
      log(game, text, "good");
    }
  }

  return lines;
};

const advanceResearch = (game: TGame, science: number): string | null => {
  const research = game.research;

  if (science <= 0) {
    return null;
  }

  if (research.current === null) {
    research.banked += science;

    return null;
  }

  const tech = TECH_BY_ID[research.current]!;
  research.progress += science;

  if (research.progress < tech.cost) {
    return null;
  }

  research.banked += research.progress - tech.cost;
  research.known.push(tech.id);
  research.current = null;
  research.progress = 0;

  const text = `Открыта технология «${tech.name}»: ${tech.effect}.`;
  log(game, text, "good");

  return text;
};

/** The end-of-turn tick for both players. Returns the lines the curtain shows. */
const runEconomy = (game: TGame): string[] => {
  const lines: string[] = [];
  let science = 0;

  for (const player of ["p1", "p2"] as const) {
    const state = game.players[player];

    if (state.defeated) {
      continue;
    }

    const income = forecastIncome(game, player);
    applyIncome(state, income);
    burnDeposits(game, player);
    science += income.science;

    lines.push(
      `${state.name}: +${income.production} производства, ${income.food >= 0 ? "+" : ""}${income.food} еды, +${income.metals} металлов, +${income.population} жителей`
    );
    lines.push(...advanceConstruction(game, player));
  }

  const discovered = advanceResearch(game, science);
  if (discovered !== null) {
    lines.push(discovered);
  } else if (science > 0) {
    lines.push(`Наука: +${science} очков`);
  }

  return lines;
};

export type { TIncome };
export { forecastIncome, runEconomy };
