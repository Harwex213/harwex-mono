import { HUMAN_PLAYER_ID } from "../store/store";
import { parseHash } from "../store/route-state";
import type {
  TBiomeId,
  TBuildingId,
  THex,
  TResources,
  TTechId,
} from "../core/exports";
import type { TAppRegistry } from "../domain/registry";
import type { TCamera } from "../store/ui-state";
import type { TLogEntry } from "../store/game-state";
import type { TPage } from "../store/route-state";
import type { TStore } from "../store/store";
import type { TTaxStage } from "../store/anim-state";

/**
 * `window.__ostrov`, the handle the Playwright probe drives the prototype
 * through (plan §4.7). It is always installed: a prototype has no production
 * build to protect, and the probe asserts on `state()` rather than on pixels.
 *
 * `state()` is a plain JSON snapshot. Nothing on it is a signal, so the probe
 * can hand it straight back over the CDP bridge.
 */

/** How many log lines the snapshot carries. The full log grows without bound. */
const LOG_TAIL_LENGTH = 20;

/** The battle input the probe needs: the island only absorbs while it flies. */
const RIGHT_INPUT = { up: false, down: false, left: false, right: true } as const;

type TDevRoute = {
  readonly page: TPage;
  readonly viewedPlayerId: string | null;
};

type TDevAnim = {
  readonly flights: number;
  readonly taxStage: TTaxStage;
  readonly lastLandingMs: number | null;
  readonly insaneAtMs: number | null;
};

type TDevWorldCell = {
  readonly id: number;
  readonly revealed: boolean;
  readonly trail: number;
  readonly occupantId: string | null;
};

type TDevWorld = {
  readonly cells: readonly TDevWorldCell[];
  readonly islandCellId: number;
};

type TDevBattleIsland = {
  readonly id: string;
  readonly absorbed: boolean;
  readonly x: number;
  readonly y: number;
};

type TDevBattleUnit = {
  readonly side: "player" | "enemy";
  readonly hp: number;
};

type TDevBattle = {
  readonly playerIsland: { readonly x: number; readonly y: number };
  readonly enemyIslands: readonly TDevBattleIsland[];
  readonly units: readonly TDevBattleUnit[];
  readonly finished: boolean;
  readonly absorbedHexes: number;
};

type TDevState = {
  readonly turn: number;
  readonly phase: string;
  readonly busy: boolean;
  readonly route: TDevRoute;
  readonly resources: TResources;
  readonly players: readonly unknown[];
  readonly island: { readonly hexes: readonly THex[] };
  readonly camera: TCamera;
  readonly anim: TDevAnim;
  readonly world: TDevWorld;
  readonly battle: TDevBattle | null;
  readonly researching: TTechId | null;
  readonly researched: readonly TTechId[];
  readonly researchProgress: Readonly<Partial<Record<TTechId, number>>>;
  readonly log: readonly TLogEntry[];
};

type TDevHook = {
  readonly store: TStore;
  readonly registry: TAppRegistry;
  readonly state: () => TDevState;
  /** Either a page name (`"island"`) or a whole hash (`"#/island/p2"`). */
  readonly navigate: (target: string, playerId?: string | null) => void;
  readonly endTurn: () => void;
  readonly fastForward: () => void;
  readonly setResources: (patch: Partial<TResources>) => void;
  readonly placeBuilding: (hexId: string, building: TBuildingId) => void;
  readonly seed: (seed: number) => void;
  readonly killAllEnemies: () => void;
  readonly stepBattle: (ticks: number) => void;
  readonly addResearch: (science: number) => void;
  readonly setResearchTarget: (tech: TTechId | null) => void;
  /** S8, the purge ritual: arms the cursor and spends 5 💠 on one hex. */
  readonly togglePurge: () => void;
  readonly purgeHex: (hexId: string) => void;
  readonly revealCell: (cellId: number) => void;
  readonly moveIsland: (cellId: number) => void;
  /** The first empty hex of that biome on the human island, or null. */
  readonly firstHexWithBiome: (biome: TBiomeId) => string | null;
};

declare global {
  interface Window {
    __ostrov: TDevHook;
  }
}

const snapshotBattle = (store: TStore): TDevBattle | null => {
  const battle = store.game.battle.peek();
  if (battle === null) {
    return null;
  }

  return {
    playerIsland: { x: battle.playerIsland.x, y: battle.playerIsland.y },
    enemyIslands: battle.enemyIslands.map((island) => {
      return { id: island.id, absorbed: island.absorbed, x: island.x, y: island.y };
    }),
    units: battle.units.map((unit) => {
      return { side: unit.side, hp: unit.hp };
    }),
    finished: battle.finished,
    absorbedHexes: battle.absorbedHexes.length,
  };
};

const snapshotState = (store: TStore): TDevState => {
  const island = store.game.islands.peek()[HUMAN_PLAYER_ID] ?? null;

  return {
    turn: store.game.turn.peek(),
    phase: store.game.phase.peek(),
    busy: store.game.busy.peek(),
    route: {
      page: store.route.page.peek(),
      viewedPlayerId: store.route.viewedPlayerId.peek(),
    },
    resources: { ...store.game.resources.peek() },
    players: store.game.players.peek().map((player) => {
      return { ...player };
    }),
    island: {
      hexes: island === null ? [] : Object.values(island.hexes),
    },
    camera: { ...store.ui.camera.peek() },
    anim: {
      flights: store.anim.flights.peek().length,
      taxStage: store.anim.taxStage.peek(),
      lastLandingMs: store.anim.lastLandingMs.peek(),
      insaneAtMs: store.anim.insaneAtMs.peek(),
    },
    world: {
      cells: store.game.worldCells.peek().map((cell) => {
        return {
          id: cell.id,
          revealed: cell.revealed,
          trail: cell.trail,
          occupantId: cell.occupantId,
        };
      }),
      islandCellId: store.game.islandCellId.peek(),
    },
    battle: snapshotBattle(store),
    researching: store.game.researching.peek(),
    researched: [...store.game.researched.peek()],
    researchProgress: { ...store.game.researchProgress.peek() },
    log: store.game.log.peek().slice(-LOG_TAIL_LENGTH),
  };
};

const installDevHook = (store: TStore, registry: TAppRegistry): void => {
  const hook: TDevHook = {
    store,
    registry,
    state: () => snapshotState(store),
    navigate: (target, playerId = null) => {
      if (target.startsWith("#") === true) {
        const route = parseHash(target);
        registry.navigate(route.page, route.viewedPlayerId);

        return;
      }

      registry.navigate(target as TPage, playerId);
    },
    endTurn: () => registry.endTurn(),
    fastForward: () => registry.fastForwardTax(),
    setResources: (patch) => {
      store.game.resources.value = { ...store.game.resources.peek(), ...patch };
    },
    placeBuilding: (hexId, building) => registry.placeBuilding(hexId, building),
    seed: (seed) => registry.setSeed(seed),
    killAllEnemies: () => registry.killAllEnemies(),
    stepBattle: (ticks) => registry.stepBattleTicks(ticks, RIGHT_INPUT),
    addResearch: (science) => registry.addResearch(science),
    setResearchTarget: (tech) => registry.setResearchTarget(tech),
    togglePurge: () => registry.togglePurge(),
    purgeHex: (hexId) => registry.purgeHex(hexId),
    revealCell: (cellId) => registry.revealCell(cellId),
    moveIsland: (cellId) => registry.moveIsland(cellId),
    firstHexWithBiome: (biome) => {
      const island = store.game.islands.peek()[HUMAN_PLAYER_ID];
      if (island === undefined) {
        return null;
      }

      const hex = Object.values(island.hexes).find((candidate) => {
        return candidate.biome === biome && candidate.building === null;
      });

      return hex === undefined ? null : hex.id;
    },
  };

  window.__ostrov = hook;
};

export type { TDevHook, TDevState };
export { installDevHook };
