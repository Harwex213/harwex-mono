import { UNIT_DEFS } from "./catalog";
import { createRng, hashSeed } from "@hw/ostrov-utils";
import { discoverFactions, engineReady, engineSteps } from "./rules";
import { factionLabel } from "./factions";
import { runAi } from "./ai";
import { runEconomy } from "./economy";
import type { TRng } from "@hw/ostrov-utils";
import type { TFaction, TGame } from "./state";

const RIVAL_PHANTOMS: readonly string[] = [
  "Ходит {name}…",
  "{name} собирает дань с подданных",
  "Дозорные {name} всматриваются в горизонт",
  "В гавани {name} стучат молоты",
  "{name} шлёт послов на соседние острова",
  "Жрецы {name} гадают по звёздам",
];

const NATIVE_PHANTOMS: readonly string[] = [
  "Сквозь ночь слышны барабаны туземцев",
  "Туземцы жгут костры на дальнем берегу",
  "Охотники туземцев вернулись с добычей",
];

const HITECH_PHANTOMS: readonly string[] = [
  "Над Нексусом гаснут и загораются огни…",
  "Дроны Нексуса чертят круги над океаном",
  "Ядро Цитадели гудит на новой частоте",
];

const phantomFor = (faction: TFaction, index: number, rng: TRng) => {
  const pool = faction.kind === "natives" ? NATIVE_PHANTOMS : faction.kind === "hitech" ? HITECH_PHANTOMS : RIVAL_PHANTOMS;
  const template = pool[rng.int(0, pool.length - 1)]!;

  return template.replace("{name}", factionLabel(faction, index));
};

/** Lines that make the world look alive while the turn is resolved. */
const phantomLines = (game: TGame, rng: TRng): string[] => {
  const lines: string[] = [];
  let unknownIndex = 1;

  for (const faction of game.factions) {
    if (faction.kind === "players" || !faction.alive) {
      continue;
    }

    const index = faction.discovered ? 0 : unknownIndex;
    if (!faction.discovered) {
      unknownIndex += 1;
    }

    lines.push(phantomFor(faction, index, rng));
  }

  return lines;
};

const resetPlayers = (game: TGame) => {
  for (const unit of Object.values(game.units)) {
    unit.movesLeft = UNIT_DEFS[unit.type].moves;
  }

  game.players.p1.ready = false;
  game.players.p2.ready = false;
  game.islandMovesLeft = engineReady(game) ? engineSteps(game) : 0;
};

/**
 * Both players pressed "end turn". The economy ticks, the other factions act, and
 * the curtain lines are collected. AI attacks land in `pendingBattles`; the UI
 * fights them after the curtain.
 */
const resolveTurn = (game: TGame) => {
  const rng = createRng(hashSeed(game.seedText) ^ (game.turn * 7919));
  const lines: string[] = [`Ход ${game.turn} завершён. Мир оживает…`];

  lines.push(...runEconomy(game));

  const phantoms = phantomLines(game, rng);
  const aiLines = runAi(game, rng);
  discoverFactions(game);

  // Phantom and real events are interleaved, so the player cannot tell them apart.
  const mixed = [...phantoms, ...aiLines];
  for (let index = mixed.length - 1; index > 0; index -= 1) {
    const swap = rng.int(0, index);
    const held = mixed[index]!;
    mixed[index] = mixed[swap]!;
    mixed[swap] = held;
  }
  lines.push(...mixed);

  resetPlayers(game);
  game.turn += 1;
  game.curtainLines = lines;
  game.phase = game.result === null ? "curtain" : "ended";
};

export { resolveTurn };
