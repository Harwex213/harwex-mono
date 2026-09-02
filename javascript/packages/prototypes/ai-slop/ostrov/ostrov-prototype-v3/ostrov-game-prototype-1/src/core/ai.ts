import { CAMP_SPAWN_EVERY } from "./catalog";
import { addUnit, buildingsOf, createSquad, factionById, islandById, tileOf, unitsOf, unitsOnTile } from "./entities";
import { HITECH_FACTION_ID, NATIVES_FACTION_ID, PLAYERS_FACTION_ID } from "./factions";
import { hexDistance } from "@hw/ostrov-utils";
import { moveUnit, reachableTiles } from "./rules";
import type { TRng } from "@hw/ostrov-utils";
import type { TFactionKind, TGame, TSquadType, TUnit } from "./state";

/** How far an AI army notices the players' units, by faction kind. */
const AGGRO_RANGE: Record<TFactionKind, number> = {
  players: 0,
  natives: 3,
  hitech: 3,
  rival: 5,
};

/** Natives only guard their camp until this turn. Then they raid. */
const NATIVES_QUIET_UNTIL = 6;

/** How far a guarding native army strays from its camp. */
const GUARD_RANGE = 1;

/** Turns between reinforcements of a rival army. */
const RIVAL_GROWTH_EVERY = 6;

const MAX_AI_SQUADS = 5;

/** Squad a rival fields at this point of the game. They keep pace with the players. */
const rivalSquadFor = (turn: number): TSquadType => {
  if (turn < 10) {
    return "spearmen";
  }

  if (turn < 20) {
    return "swordsmen";
  }

  if (turn < 32) {
    return "riflemen";
  }

  return "plasma";
};

const playerUnits = (game: TGame) => unitsOf(game, PLAYERS_FACTION_ID);

const nearestPlayerUnit = (game: TGame, army: TUnit): { unit: TUnit; distance: number } | null => {
  const from = tileOf(game, army);
  let best: { unit: TUnit; distance: number } | null = null;

  for (const unit of playerUnits(game)) {
    const distance = hexDistance(from, tileOf(game, unit));

    if (best === null || distance < best.distance) {
      best = { unit, distance };
    }
  }

  return best;
};

/** Hexes the army may wander to: reachable, and not somebody else's. */
const wanderTargets = (game: TGame, army: TUnit) => {
  return [...reachableTiles(game, army).keys()].filter((tileId) => {
    const tile = game.tiles[tileId]!;
    const foreignUnit = unitsOnTile(game, tileId).some((unit) => unit.factionId !== army.factionId);
    const building = tile.buildingId === null ? null : game.buildings[tile.buildingId]!;
    const foreignBuilding = building !== null && building.factionId !== army.factionId;

    return !foreignUnit && !foreignBuilding;
  });
};

/**
 * One army acts: it strikes a players' unit it can reach, closes in on one it can
 * see, or, if it is allowed to roam, wanders its own island.
 */
const actArmy = (game: TGame, army: TUnit, rng: TRng, roams: boolean): string | null => {
  army.movesLeft = 2;
  const faction = factionById(game, army.factionId);
  const guarding = faction.kind === "natives" && game.turn < NATIVES_QUIET_UNTIL;

  // A guard strikes only what comes next to its camp, and never leaves it.
  const reach = new Map([...reachableTiles(game, army)].filter(([tileId]) => !guarding || hexDistance(game.tiles[tileId]!, tileOf(game, army)) <= GUARD_RANGE));

  const strikeable = [...reach.keys()].filter((tileId) => unitsOnTile(game, tileId).some((unit) => unit.factionId === PLAYERS_FACTION_ID));
  if (strikeable.length > 0) {
    // Armies first: a battle is the point. Civilians are taken if nothing else is near.
    const withArmy = strikeable.filter((tileId) => unitsOnTile(game, tileId).some((unit) => unit.type === "army"));
    const target = (withArmy.length > 0 ? withArmy : strikeable)[0]!;
    const outcome = moveUnit(game, army.id, target);

    if (outcome.kind === "battle") {
      game.pendingBattles.push(outcome.setup);

      return `${faction.name} — атака на ваши войска!`;
    }

    if (outcome.kind === "captured") {
      return `${faction.name} — захват гекса Союза!`;
    }

    return null;
  }

  const nearest = nearestPlayerUnit(game, army);
  if (nearest !== null && nearest.distance <= AGGRO_RANGE[faction.kind]) {
    const goal = tileOf(game, nearest.unit);
    const step = wanderTargets(game, army).sort((a, b) => hexDistance(game.tiles[a]!, goal) - hexDistance(game.tiles[b]!, goal))[0];

    if (!guarding && step !== undefined && hexDistance(game.tiles[step]!, goal) < nearest.distance) {
      moveUnit(game, army.id, step);

      return `${faction.name} — войска стягиваются к вашим позициям`;
    }
  }

  if (roams && !guarding && rng.next() < 0.35) {
    const options = wanderTargets(game, army);
    const pick = options[rng.int(0, Math.max(0, options.length - 1))];

    if (pick !== undefined) {
      moveUnit(game, army.id, pick);
    }
  }

  return null;
};

const growRivals = (game: TGame): string[] => {
  const lines: string[] = [];

  if (game.turn % RIVAL_GROWTH_EVERY !== 0) {
    return lines;
  }

  for (const faction of game.factions) {
    if (faction.kind !== "rival" || !faction.alive) {
      continue;
    }

    for (const army of unitsOf(game, faction.id)) {
      if (army.type === "army" && army.squads.length < MAX_AI_SQUADS) {
        army.squads.push(createSquad(game, rivalSquadFor(game.turn)));
      }
    }

    lines.push(`${faction.discovered ? faction.name : "Далёкая фракция"} собирает новое войско`);
  }

  return lines;
};

const spawnNatives = (game: TGame): string[] => {
  const lines: string[] = [];

  if (game.turn % CAMP_SPAWN_EVERY !== 0) {
    return lines;
  }

  for (const camp of buildingsOf(game, NATIVES_FACTION_ID)) {
    if (camp.type !== "camp") {
      continue;
    }

    const tile = game.tiles[camp.tileId]!;
    const onIsland = unitsOf(game, NATIVES_FACTION_ID).filter((unit) => tileOf(game, unit).islandId === tile.islandId);

    if (onIsland.length >= 2) {
      continue;
    }

    const squads: TSquadType[] = game.turn >= 15 ? ["tribesmen", "tribesmen", "tribesmen"] : ["tribesmen", "tribesmen"];
    addUnit(game, "army", NATIVES_FACTION_ID, null, camp.tileId, squads);
    lines.push(`Лагерь туземцев на острове ${islandById(game, tile.islandId).name} выпустил новый отряд`);
  }

  return lines;
};

/** Every faction but the players acts. Returns what the curtain should tell. */
const runAi = (game: TGame, rng: TRng): string[] => {
  const lines: string[] = [];

  lines.push(...spawnNatives(game));
  lines.push(...growRivals(game));

  for (const faction of game.factions) {
    if (faction.kind === "players" || !faction.alive) {
      continue;
    }

    const roams = faction.id !== HITECH_FACTION_ID;

    for (const army of unitsOf(game, faction.id)) {
      if (army.type !== "army" || game.units[army.id] === undefined) {
        continue;
      }

      const line = actArmy(game, army, rng, roams);
      if (line !== null) {
        lines.push(line);
      }
    }
  }

  return lines;
};

export { runAi };
