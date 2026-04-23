import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TGameContext, TGameTurn, TGameTurnPhaseEvent, TProvinceRaw } from "@hw/faenwald-core";
import type { TGameContextSerialized } from "./data-source-types.js";

const BASE_PATH = path.join(import.meta.dirname, "..", "..");
const PATH = {
  PROVINCES: path.join(BASE_PATH, "data/provinces.json"),
  GAME_CONTEXT: path.join(BASE_PATH, "data/game-context.json"),
  events: (turn: number, phase: number) => path.join(BASE_PATH, `data/events/${turn}-turn/${phase}-phase.json`),
};

// TODO: change to sqlite
const loadGameContext = async (): Promise<TGameContext> => {
  const provincesJSON = await fs.readFile(PATH.PROVINCES, "utf-8");
  const gameContextJSON = await fs.readFile(PATH.GAME_CONTEXT, "utf-8");

  const provincesRaw = JSON.parse(provincesJSON) as Record<string, TProvinceRaw>;
  const gameContextRaw = JSON.parse(gameContextJSON) as TGameContextSerialized;

  const turns: TGameTurn[] = [];

  for (let currentTurn = gameContextRaw.gameState.currentTurn; currentTurn > 0; currentTurn--) {
    const turn: TGameTurn = {
      turn: currentTurn,
      phases: [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
      ],
    };

    for (let currentPhase = gameContextRaw.gameState.currentPhase; currentPhase > 0; currentPhase--) {
      const eventsJSON = await fs.readFile(PATH.events(currentTurn, currentPhase), "utf-8");

      turn.phases[currentPhase] = JSON.parse(eventsJSON) as TGameTurnPhaseEvent[];
    }

    turns.unshift(turn);
  }

  return {
    counters: {
      ...gameContextRaw.counters,
    },
    gameState: {
      ...gameContextRaw.gameState,
    },
    provincesRaw,
    allTurnsValid: true,
    turns,
  };
};

// TODO: change to sqlite
const flushGameContext = async (gameContext: TGameContext): Promise<void> => {
  const provincesRaw = gameContext.provincesRaw;

  await fs.writeFile(PATH.PROVINCES, JSON.stringify(provincesRaw, null, 2), "utf-8");

  const gameContextSerialized: TGameContextSerialized = {
    counters: gameContext.counters,
    gameState: gameContext.gameState
  };

  await fs.writeFile(PATH.GAME_CONTEXT, JSON.stringify(gameContextSerialized, null, 2), "utf-8");

  const writeTurns: Promise<void>[] = [];

  for (const turn of gameContext.turns) {
    const turnNumber = turn.turn;

    for (let phase = 0; phase < turn.phases.length; phase++) {
      writeTurns.push(
        fs.writeFile(PATH.events(turnNumber, phase), JSON.stringify(turn.phases[phase], null, 2), "utf-8"),
      );
    }
  }

  await Promise.all(writeTurns);
};

export {
  loadGameContext,
  flushGameContext,
};
