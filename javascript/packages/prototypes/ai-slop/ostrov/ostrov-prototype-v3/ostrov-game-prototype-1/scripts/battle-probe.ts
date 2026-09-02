/**
 * Fixed matchups through the auto-battler, thirty runs each. Run with `yarn probe`
 * after touching squad stats or the armour formula.
 */
import { createBattle, createGame, runRound } from "../src/core/exports";
import { addUnit } from "../src/core/entities";
import { createRng } from "@hw/ostrov-utils";
import type { TSquadType } from "../src/core/exports";

const game = createGame("PROBE");
const rng = createRng(3);
const home = game.islands.find((i) => i.home)!;
const camp = Object.values(game.buildings).find((b) => b.type === "camp" && game.tiles[b.tileId]!.islandId === home.id)!;
const core = Object.values(game.buildings).find((b) => b.type === "core")!;
const free = home.tileIds.map((id) => game.tiles[id]!).filter((t) => t.buildingId === null)[0]!;

const probe = (label: string, attackers: TSquadType[], defenderTile: string, defenderFaction: string, defenders: TSquadType[] | null, runs = 30) => {
  let wins = 0;
  let rounds = 0;
  for (let i = 0; i < runs; i += 1) {
    const g = structuredClone(game);
    const a = addUnit(g, "army", "union", "p1", defenderTile, attackers);
    const existing = Object.values(g.units).filter((u) => u.tileId === defenderTile && u.factionId === defenderFaction);
    const d = defenders === null ? existing : [addUnit(g, "army", defenderFaction, null, defenderTile, defenders)];
    const battle = createBattle(g, { id: "x", tileId: defenderTile, attackerFactionId: "union", defenderFactionId: defenderFaction, attackerUnitIds: [a.id], defenderUnitIds: d.map((u) => u.id), attackerPlayer: "p1" });
    while (battle.phase !== "done") {
      runRound(battle, rng);
    }
    rounds += battle.round;
    if (battle.winner === "attacker") {
      wins += 1;
    }
  }
  console.log(`${label}: attacker wins ${wins}/${runs}, avg rounds ${(rounds / runs).toFixed(1)}`);
};

probe("2 militia vs camp guard (2 tribesmen, fortified)", ["militia", "militia"], camp.tileId, "natives", null);
probe("4 militia vs camp guard", ["militia", "militia", "militia", "militia"], camp.tileId, "natives", null);
probe("3 spearmen vs camp guard", ["spearmen", "spearmen", "spearmen"], camp.tileId, "natives", null);
probe("2 militia defend vs 2 tribesmen raid (open field)", ["tribesmen", "tribesmen"], free.id, "union", ["militia", "militia"]);
probe("3 swordsmen+2 archers vs rival 2 spear+archer fortified", ["swordsmen", "swordsmen", "swordsmen", "archers", "archers"], free.id, "amber", ["spearmen", "spearmen", "archers"]);
probe("6 riflemen vs core (mech+2 drones fortified)", ["riflemen", "riflemen", "riflemen", "riflemen", "riflemen", "riflemen"], core.tileId, "nexus", null);
probe("6 plasma vs core", ["plasma", "plasma", "plasma", "plasma", "plasma", "plasma"], core.tileId, "nexus", null);
probe("4 plasma + 2 catapult vs core", ["plasma", "plasma", "plasma", "plasma", "catapult", "catapult"], core.tileId, "nexus", null);
