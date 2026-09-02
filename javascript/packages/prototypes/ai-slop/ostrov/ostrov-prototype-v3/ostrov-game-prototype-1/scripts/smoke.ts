/**
 * Headless soak: eight seeds, sixty turns of random play by both seats, every
 * battle auto-resolved. Run with `yarn smoke`. Throws when an island breaks
 * the 6..25 size rule; prints world and economy figures otherwise.
 */
import {
  PLAYERS_FACTION_ID,
  buildOptions,
  createBattle,
  createGame,
  finishBattle,
  formArmy,
  foundPower,
  investEngine,
  isResearchable,
  islandMoveBlocker,
  moveIsland,
  moveUnit,
  reachableTiles,
  resolveTurn,
  runRound,
  setResearch,
  startBuilding,
  trainCivilian,
  TECH_DEFS,
  unitsOf,
  buildingsOf,
} from "../src/core/exports";
import { createRng } from "@hw/ostrov-utils";
import type { TBattleSetup, TGame } from "../src/core/exports";

const fight = (game: TGame, setup: TBattleSetup, rng: ReturnType<typeof createRng>) => {
  const battle = createBattle(game, setup);
  let guard = 0;
  while (battle.phase !== "done" && guard < 50) {
    runRound(battle, rng);
    guard += 1;
  }
  finishBattle(game, battle);
  return battle.winner;
};

const stats = { battles: 0, wins: 0, captured: 0, techs: 0, islandMoves: 0, victories: 0, defeats: 0 };

for (const seed of ["OSTROV", "A1", "B2", "C3", "D4", "E5", "F6", "G7"]) {
  const game = createGame(seed);
  const rng = createRng(7);
  const home = game.islands.find((i) => i.home)!;
  const citadel = game.islands.find((i) => i.citadel)!;
  console.log(
    `seed ${seed}: islands=${game.islands.length} tiles=${Object.keys(game.tiles).length} home=${home.name}(${home.tileIds.length}) citadel=${citadel.tileIds.length} units=${Object.keys(game.units).length} buildings=${Object.keys(game.buildings).length} rivalsAlive=${game.factions.filter((f) => f.kind === "rival" && f.alive).length}`
  );
  const sizes = game.islands.filter((i) => !i.citadel).map((i) => i.tileIds.length);
  if (Math.min(...sizes) < 6 || Math.max(...sizes) > 25) {
    throw new Error(`island size out of range: ${sizes}`);
  }

  for (let turn = 0; turn < 60 && game.phase !== "ended"; turn += 1) {
    for (const player of ["p1", "p2"] as const) {
      for (const unit of unitsOf(game, PLAYERS_FACTION_ID).filter((u) => u.owner === player)) {
        if (game.units[unit.id] === undefined) {
          continue;
        }
        if (unit.type === "settler" && rng.next() < 0.6) {
          foundPower(game, unit.id);
          continue;
        }
        if (unit.type === "builders") {
          const options = buildOptions(game, unit).filter((o) => o.reason === null);
          if (options.length > 0 && rng.next() < 0.7) {
            startBuilding(game, unit.id, options[rng.int(0, options.length - 1)]!.type);
            continue;
          }
        }
        const reach = [...reachableTiles(game, unit).keys()];
        if (reach.length > 0 && rng.next() < 0.6) {
          const outcome = moveUnit(game, unit.id, reach[rng.int(0, reach.length - 1)]!);
          if (outcome.kind === "battle") {
            stats.battles += 1;
            if (fight(game, outcome.setup, rng) === "attacker") {
              stats.wins += 1;
            }
          } else if (outcome.kind === "captured") {
            stats.captured += 1;
          }
        }
      }
      trainCivilian(game, player, rng.next() < 0.5 ? "builders" : "settler");
      for (const b of buildingsOf(game, PLAYERS_FACTION_ID)) {
        if (b.type === "barracks") {
          formArmy(game, player, b.id);
        }
      }
      investEngine(game, player, 10);
    }
    if (game.research.current === null) {
      const open = TECH_DEFS.filter((t) => isResearchable(game.research, t.id));
      if (open.length > 0) {
        setResearch(game, open[rng.int(0, open.length - 1)]!.id);
      }
    }
    for (let d = 0; d < 6; d += 1) {
      if (islandMoveBlocker(game, d) === null) {
        moveIsland(game, d);
        stats.islandMoves += 1;
        break;
      }
    }
    if (game.phase === "ended") {
      break;
    }
    resolveTurn(game);
    while (game.pendingBattles.length > 0 && game.phase !== "ended") {
      const setup = game.pendingBattles.shift()!;
      const ok = setup.attackerUnitIds.every((id) => game.units[id]) && setup.defenderUnitIds.some((id) => game.units[id]);
      if (ok) {
        stats.battles += 1;
        fight(game, setup, rng);
      }
    }
    if (game.phase === "curtain") {
      game.phase = "planning";
    }
  }
  stats.techs += game.research.known.length;
  if (game.result === "victory") {
    stats.victories += 1;
  }
  if (game.result === "defeat") {
    stats.defeats += 1;
  }
  console.log(
    `  after turn ${game.turn}: result=${game.result} known=${game.research.known.length} p1=${JSON.stringify({ pr: game.players.p1.production, food: game.players.p1.food, met: game.players.p1.metals, pop: game.players.p1.population, def: game.players.p1.defeated })} units=${unitsOf(game, PLAYERS_FACTION_ID).length} buildings=${buildingsOf(game, PLAYERS_FACTION_ID).length} curtain=${game.curtainLines.length} log=${game.log.length}`
  );
}
console.log(stats);
