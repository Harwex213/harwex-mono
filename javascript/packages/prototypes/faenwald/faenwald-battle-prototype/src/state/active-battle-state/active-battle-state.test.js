import { describe, test } from "node:test";
import assert from "node:assert";
import { BATTLE_PHASE } from "../../data/battle.js";
import {
  accelerate,
  advanceUnit,
  applyBreakthrough,
  attack,
  capitulate,
  checkVictory,
  createActiveBattle,
  declineBreakthrough,
  effectiveMorale,
  endActivation,
  fireModesAvailable,
  resetActiveBattle,
  rotateUnit,
  routTick,
  rulerAuraBonus,
  startBattle,
  startBattleDisposition,
  validRangedTargets
} from "./active-battle-state.js";

const PRISTINE = {
  phase: null,
  mapId: null,
  units: [],
  nextUnitId: 1,
  round: 0,
  activeGroup: null,
  activeUnitId: null,
  actedUnitIds: [],
  log: [],
  winner: null,
  pendingBreakthrough: null,
  pendingOpportunity: null,
};

const buildUnit = (overrides = {}) => ({
  id: 1,
  side: "attacker",
  type: "light-cavalry",
  name: "Cav",
  hp: 70,
  maxHp: 70,
  attack: 10,
  morale: 80,
  speed: 5,
  position: { row: 1, col: 1 },
  facing: 4,
  movePoints: 0,
  mpCarry: 0,
  hasAttacked: false,
  accelerated: false,
  freeRotationUsed: false,
  ammo: 0,
  cooldown: 0,
  routed: false,
  isRulerUnit: false,
  destroyed: false,
  chargeHexes: 0,
  attackedRound: null,
  reactedRound: null,
  ...overrides,
});

const buildMap = (overrides = {}) => {
  const cells = [
    ["plain", "plain", "plain"],
    ["plain", "plain", "plain"],
    ["plain", "plain", "plain"],
  ];
  for (const [key, terrain] of Object.entries(overrides)) {
    const [row, col] = key.split(":").map(Number);
    cells[row][col] = terrain;
  }
  return { id: 1, name: "m", width: 3, height: 3, cells };
};

const makeActiveState = (unit, extraUnits = []) => {
  const state = createActiveBattle();
  state.phase = BATTLE_PHASE.ACTIVE;
  state.units = [unit, ...extraUnits];
  state.activeUnitId = unit.id;
  return state;
};

describe("reset", () => {
  test("returns a finished battle to the pristine shape", () => {
    const state = createActiveBattle();
    state.phase = BATTLE_PHASE.FINISHED;
    state.mapId = "m1";
    state.units = [buildUnit()];
    state.nextUnitId = 7;
    state.round = 3;
    state.activeGroup = { side: "attacker", type: "cavalry" };
    state.activeUnitId = 1;
    state.actedUnitIds = [1];
    state.log = ["x"];

    resetActiveBattle(state);

    assert.deepStrictEqual(state, PRISTINE);
  });

  test("is idempotent on a pristine state", () => {
    const state = createActiveBattle();

    resetActiveBattle(state);

    assert.deepStrictEqual(state, createActiveBattle());
  });

  test("mutates in place and returns undefined", () => {
    const state = createActiveBattle();
    state.phase = BATTLE_PHASE.FINISHED;

    const ret = resetActiveBattle(state);

    assert.strictEqual(ret, undefined);
    assert.strictEqual(state.phase, null);
  });

  test("unblocks startBattleDisposition after a finished battle", () => {
    const state = createActiveBattle();
    state.phase = BATTLE_PHASE.FINISHED;

    resetActiveBattle(state);
    startBattleDisposition(
      state,
      { mapId: "m1", attacker: [], defender: [], nextUnitId: 1 },
      { collections: [] },
    );

    assert.strictEqual(state.phase, BATTLE_PHASE.DISPOSITION);
    assert.strictEqual(state.mapId, "m1");
    assert.deepStrictEqual(state.units, []);
  });
});

describe("startBattle", () => {
  test("seeds round 1, the first group, and its fastest unit's activation", () => {
    const fast = buildUnit({ id: 1, speed: 5 });
    const slow = buildUnit({ id: 2, speed: 3, position: { row: 1, col: 2 } });
    const state = createActiveBattle();
    state.phase = BATTLE_PHASE.DISPOSITION;
    state.units = [slow, fast];
    const map = buildMap();

    startBattle(state, map);

    assert.strictEqual(state.phase, BATTLE_PHASE.ACTIVE);
    assert.strictEqual(state.round, 1);
    assert.deepStrictEqual(state.activeGroup, { side: "attacker", type: "cavalry" });
    assert.strictEqual(state.activeUnitId, fast.id);
    assert.strictEqual(fast.movePoints, fast.speed);
    assert.ok(state.log.length > 0);
  });

  test("is a no-op when the battle is not in disposition", () => {
    const unit = buildUnit();
    const state = createActiveBattle();
    state.phase = BATTLE_PHASE.ACTIVE;
    state.units = [unit];
    const map = buildMap();

    startBattle(state, map);

    assert.strictEqual(state.round, 0);
    assert.strictEqual(state.activeUnitId, null);
  });
});

describe("advanceUnit", () => {
  test("moves into a front hex and decrements movePoints by the terrain cost", () => {
    const unit = buildUnit({ movePoints: 3 });
    const state = makeActiveState(unit);
    const map = buildMap();

    advanceUnit(state, { row: 2, col: 1 }, map);

    assert.deepStrictEqual(unit.position, { row: 2, col: 1 });
    assert.strictEqual(unit.movePoints, 2);
    assert.ok(state.log.length > 0);
  });

  test("rejects a non-front target", () => {
    const unit = buildUnit({ movePoints: 3 });
    const state = makeActiveState(unit);
    const map = buildMap();

    advanceUnit(state, { row: 0, col: 0 }, map);

    assert.deepStrictEqual(unit.position, { row: 1, col: 1 });
    assert.strictEqual(unit.movePoints, 3);
  });

  test("rejects an occupied target", () => {
    const unit = buildUnit({ movePoints: 3 });
    const occupant = buildUnit({ id: 2, position: { row: 2, col: 1 } });
    const state = makeActiveState(unit, [occupant]);
    const map = buildMap();

    advanceUnit(state, { row: 2, col: 1 }, map);

    assert.deepStrictEqual(unit.position, { row: 1, col: 1 });
    assert.strictEqual(unit.movePoints, 3);
  });

  test("rejects an impassable target", () => {
    const unit = buildUnit({ movePoints: 3 });
    const state = makeActiveState(unit);
    const map = buildMap({ "2:1": "water" });

    advanceUnit(state, { row: 2, col: 1 }, map);

    assert.deepStrictEqual(unit.position, { row: 1, col: 1 });
    assert.strictEqual(unit.movePoints, 3);
  });

  test("rejects when movePoints are below the cost", () => {
    const unit = buildUnit({ movePoints: 0.5 });
    const state = makeActiveState(unit);
    const map = buildMap();

    advanceUnit(state, { row: 2, col: 1 }, map);

    assert.deepStrictEqual(unit.position, { row: 1, col: 1 });
    assert.strictEqual(unit.movePoints, 0.5);
  });

  test("rejects once the unit has attacked (non-maneuverable type)", () => {
    const unit = buildUnit({ type: "medium-spearman", movePoints: 3, hasAttacked: true });
    const state = makeActiveState(unit);
    const map = buildMap();

    advanceUnit(state, { row: 2, col: 1 }, map);

    assert.deepStrictEqual(unit.position, { row: 1, col: 1 });
    assert.strictEqual(unit.movePoints, 3);
  });
});

describe("rotateUnit", () => {
  test("a non-heavy rotation costs 1 MP", () => {
    const unit = buildUnit({ movePoints: 3, facing: 4 });
    const state = makeActiveState(unit);

    rotateUnit(state, 2);

    assert.strictEqual(unit.facing, 2);
    assert.strictEqual(unit.movePoints, 2);
  });

  test("rejects invalid facings", () => {
    const unit = buildUnit({ movePoints: 3, facing: 4 });
    const state = makeActiveState(unit);

    rotateUnit(state, 6);
    rotateUnit(state, -1);
    rotateUnit(state, 1.5);

    assert.strictEqual(unit.facing, 4);
    assert.strictEqual(unit.movePoints, 3);
  });

  test("is a no-op for the same facing", () => {
    const unit = buildUnit({ movePoints: 3, facing: 4 });
    const state = makeActiveState(unit);

    rotateUnit(state, 4);

    assert.strictEqual(unit.movePoints, 3);
  });

  test("heavy units rotate free once, then pay 1 MP", () => {
    const unit = buildUnit({ type: "heavy-infantry", movePoints: 3, facing: 4 });
    const state = makeActiveState(unit);

    rotateUnit(state, 2);
    assert.strictEqual(unit.facing, 2);
    assert.strictEqual(unit.movePoints, 3);
    assert.strictEqual(unit.freeRotationUsed, true);

    rotateUnit(state, 0);
    assert.strictEqual(unit.facing, 0);
    assert.strictEqual(unit.movePoints, 2);
  });
});

describe("accelerate", () => {
  test("doubles movePoints and costs morale", () => {
    const unit = buildUnit({ movePoints: 3, morale: 80 });
    const state = makeActiveState(unit);
    const map = buildMap();

    accelerate(state, map);

    assert.strictEqual(unit.morale, 70);
    assert.strictEqual(unit.movePoints, 6);
    assert.strictEqual(unit.accelerated, true);
  });

  test("is a no-op on a second call", () => {
    const unit = buildUnit({ movePoints: 3, morale: 80, accelerated: true });
    const state = makeActiveState(unit);
    const map = buildMap();

    accelerate(state, map);

    assert.strictEqual(unit.morale, 80);
    assert.strictEqual(unit.movePoints, 3);
  });

  test("cavalry standing on forest cannot accelerate", () => {
    const unit = buildUnit({ movePoints: 3, morale: 80 });
    const state = makeActiveState(unit);
    const map = buildMap({ "1:1": "forest" });

    accelerate(state, map);

    assert.strictEqual(unit.morale, 80);
    assert.strictEqual(unit.movePoints, 3);
    assert.strictEqual(unit.accelerated, false);
  });
});

describe("MP accumulation across activations", () => {
  test("a partial-cost move is carried over and restored on reactivation", () => {
    const unit = buildUnit({ speed: 1, movePoints: 1 });
    const state = createActiveBattle();
    state.phase = BATTLE_PHASE.ACTIVE;
    state.units = [unit];
    state.activeGroup = { side: "attacker", type: "cavalry" };
    state.activeUnitId = unit.id;
    state.round = 1;
    const map = buildMap({ "2:1": "hills" });

    // {2,1} is a front hex; climbing to hills costs 2 MP, unit only has 1
    advanceUnit(state, { row: 2, col: 1 }, map);
    assert.strictEqual(unit.movePoints, 1);

    // single-unit, single-group battle: the group wraps back to this unit
    // within one endActivation call, banking then restoring its MP + carry
    endActivation(state, map);

    assert.strictEqual(state.round, 2);
    assert.strictEqual(state.activeUnitId, unit.id);
    assert.strictEqual(unit.movePoints, 2);

    advanceUnit(state, { row: 2, col: 1 }, map);
    assert.deepStrictEqual(unit.position, { row: 2, col: 1 });
    assert.strictEqual(unit.movePoints, 0);
  });
});

describe("endActivation ordering", () => {
  test("activates the next unit in speed/id order, then advances the group", () => {
    const fast = buildUnit({ id: 1, speed: 5, movePoints: 5 });
    const slow = buildUnit({ id: 2, speed: 3, movePoints: 3, position: { row: 1, col: 2 } });
    const state = createActiveBattle();
    state.phase = BATTLE_PHASE.ACTIVE;
    state.units = [slow, fast];
    state.activeGroup = { side: "attacker", type: "cavalry" };
    state.activeUnitId = fast.id;
    state.round = 1;
    const map = buildMap();

    endActivation(state, map);

    assert.strictEqual(state.activeUnitId, slow.id);
    assert.deepStrictEqual(state.actedUnitIds, [fast.id]);
    assert.strictEqual(state.round, 1);

    endActivation(state, map);

    // only group in play; wraps and increments the round, resetting actedUnitIds
    assert.strictEqual(state.round, 2);
    assert.deepStrictEqual(state.actedUnitIds, []);
  });
});

// attacker at {1,1} facing 4, target at {2,1} — a front hex of the attacker.
// Zone is measured on the TARGET's facing toward the attacker: directionTo
// gives dir 1 (NE) from the target, so target facing 4 -> rear (d=3),
// facing 1 -> front (d=0), facing 5 -> flank (d=2).
const buildAttacker = (overrides = {}) => buildUnit({
  id: 1,
  side: "attacker",
  position: { row: 1, col: 1 },
  facing: 4,
  attack: 20,
  hp: 100,
  maxHp: 100,
  movePoints: 5,
  ...overrides,
});

const buildTarget = (overrides = {}) => buildUnit({
  id: 2,
  side: "defender",
  position: { row: 2, col: 1 },
  facing: 4,
  hp: 100,
  maxHp: 100,
  morale: 80,
  ...overrides,
});

describe("attack", () => {
  test("reduces target hp & morale, sets attacker.hasAttacked, pushes log", () => {
    const attacker = buildAttacker();
    const target = buildTarget();
    const state = makeActiveState(attacker, [target]);
    const map = buildMap();

    attack(state, target.id, map);

    assert.strictEqual(target.hp, 80);
    assert.strictEqual(target.morale, 50);
    assert.strictEqual(attacker.hasAttacked, true);
    assert.ok(state.log.length > 0);
  });

  test("rejects a non-adjacent target", () => {
    const attacker = buildAttacker();
    const target = buildTarget({ position: { row: 0, col: 0 } });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap();

    attack(state, target.id, map);

    assert.strictEqual(target.hp, 100);
    assert.strictEqual(attacker.hasAttacked, false);
  });

  test("rejects a friendly target", () => {
    const attacker = buildAttacker();
    const target = buildTarget({ side: "attacker" });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap();

    attack(state, target.id, map);

    assert.strictEqual(target.hp, 100);
    assert.strictEqual(attacker.hasAttacked, false);
  });

  test("rejects once the attacker has already attacked", () => {
    const attacker = buildAttacker({ hasAttacked: true });
    const target = buildTarget();
    const state = makeActiveState(attacker, [target]);
    const map = buildMap();

    attack(state, target.id, map);

    assert.strictEqual(target.hp, 100);
  });

  test("rejects when the attacker is routed", () => {
    const attacker = buildAttacker({ routed: true });
    const target = buildTarget();
    const state = makeActiveState(attacker, [target]);
    const map = buildMap();

    attack(state, target.id, map);

    assert.strictEqual(target.hp, 100);
  });

  test("rejects a destroyed target", () => {
    const attacker = buildAttacker();
    const target = buildTarget({ destroyed: true });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap();

    attack(state, target.id, map);

    assert.strictEqual(attacker.hasAttacked, false);
  });

  test("facing multiplier: flank hit deals more morale damage than front", () => {
    const frontAttacker = buildAttacker();
    const frontTarget = buildTarget({ facing: 1 });
    const frontState = makeActiveState(frontAttacker, [frontTarget]);
    attack(frontState, frontTarget.id, buildMap());

    const flankAttacker = buildAttacker();
    const flankTarget = buildTarget({ facing: 5 });
    const flankState = makeActiveState(flankAttacker, [flankTarget]);
    attack(flankState, flankTarget.id, buildMap());

    const frontMoraleDamage = 80 - frontTarget.morale;
    const flankMoraleDamage = 80 - flankTarget.morale;
    assert.ok(flankMoraleDamage > frontMoraleDamage);
    assert.strictEqual(100 - frontTarget.hp, 100 - flankTarget.hp);
  });

  test("destroys the target when hp drops to 0 or below; retained off-field", () => {
    const attacker = buildAttacker();
    const target = buildTarget({ hp: 15, morale: 80 });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap();

    attack(state, target.id, map);

    assert.strictEqual(target.destroyed, true);
    assert.strictEqual(target.position, null);
    assert.ok(state.units.includes(target));
  });

  test("routs the target when morale drops to 0 or below, HP permitting", () => {
    const attacker = buildAttacker();
    const target = buildTarget({ hp: 100, morale: 25 });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap();

    attack(state, target.id, map);

    assert.strictEqual(target.routed, true);
    assert.notStrictEqual(target.position, null);
    assert.strictEqual(target.destroyed, false);
  });
});

describe("morale shock", () => {
  test("allies at distance 1 and 2 lose morale, distance 3 is unaffected", () => {
    const attacker = buildAttacker();
    const target = buildTarget({ hp: 15 });
    const allyD1 = buildUnit({
      id: 3, side: "defender", position: { row: 2, col: 2 }, morale: 80, hp: 50, maxHp: 50,
    });
    const allyD2 = buildUnit({
      id: 4, side: "defender", position: { row: 0, col: 1 }, morale: 80, hp: 50, maxHp: 50,
    });
    const allyD3 = buildUnit({
      id: 5, side: "defender", position: { row: -1, col: 0 }, morale: 80, hp: 50, maxHp: 50,
    });
    const state = makeActiveState(attacker, [target, allyD1, allyD2, allyD3]);
    const map = buildMap();

    attack(state, target.id, map);

    assert.strictEqual(allyD1.morale, 70);
    assert.strictEqual(allyD2.morale, 75);
    assert.strictEqual(allyD3.morale, 80);
  });

  test("ruler unit lost doubles the shock", () => {
    const attacker = buildAttacker();
    const target = buildTarget({ hp: 15, isRulerUnit: true });
    const allyD1 = buildUnit({
      id: 3, side: "defender", position: { row: 2, col: 2 }, morale: 80, hp: 50, maxHp: 50,
    });
    const allyD2 = buildUnit({
      id: 4, side: "defender", position: { row: 0, col: 1 }, morale: 80, hp: 50, maxHp: 50,
    });
    const state = makeActiveState(attacker, [target, allyD1, allyD2]);
    const map = buildMap();

    attack(state, target.id, map);

    assert.strictEqual(allyD1.morale, 60);
    assert.strictEqual(allyD2.morale, 70);
  });

  test("shock chains into a second rout, whose own shock reaches a further ally", () => {
    const attacker = buildAttacker();
    const target = buildTarget({ hp: 15 });
    const allyD1 = buildUnit({
      id: 3, side: "defender", position: { row: 2, col: 2 }, morale: 8, hp: 50, maxHp: 50,
    });
    const furtherAlly = buildUnit({
      id: 4, side: "defender", position: { row: 2, col: 4 }, morale: 50, hp: 50, maxHp: 50,
    });
    const state = makeActiveState(attacker, [target, allyD1, furtherAlly]);
    const map = buildMap();

    attack(state, target.id, map);

    assert.strictEqual(allyD1.routed, true);
    assert.strictEqual(furtherAlly.morale, 45);
  });
});

describe("victory / draw", () => {
  test("destroying the last defender fighter ends the battle in an attacker win", () => {
    const attacker = buildAttacker();
    const target = buildTarget({ hp: 15 });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap();

    attack(state, target.id, map);

    assert.strictEqual(state.phase, BATTLE_PHASE.FINISHED);
    assert.strictEqual(state.winner, "attacker");
    assert.strictEqual(state.activeUnitId, null);
  });

  test("checkVictory declares a draw when both sides are out of fighters", () => {
    const attackerUnit = buildAttacker({ destroyed: true, position: null });
    const defenderUnit = buildTarget({ routed: true });
    const state = makeActiveState(attackerUnit, [defenderUnit]);

    checkVictory(state);

    assert.strictEqual(state.phase, BATTLE_PHASE.FINISHED);
    assert.strictEqual(state.winner, "draw");
  });
});

describe("capitulate", () => {
  test("attacker capitulating hands the win to the defender", () => {
    const unit = buildUnit();
    const state = makeActiveState(unit);

    capitulate(state, "attacker");

    assert.strictEqual(state.phase, BATTLE_PHASE.FINISHED);
    assert.strictEqual(state.winner, "defender");
    assert.strictEqual(state.activeUnitId, null);
  });

  test("is a no-op when the battle is not active", () => {
    const unit = buildUnit();
    const state = makeActiveState(unit);
    state.phase = BATTLE_PHASE.FINISHED;

    capitulate(state, "attacker");

    assert.strictEqual(state.winner, null);
  });

  test("is a no-op for an invalid side", () => {
    const unit = buildUnit();
    const state = makeActiveState(unit);

    capitulate(state, "spectator");

    assert.strictEqual(state.phase, BATTLE_PHASE.ACTIVE);
    assert.strictEqual(state.winner, null);
  });
});

describe("routTick", () => {
  test("a routed unit with enough MP flees all the way to its deployment edge", () => {
    const unit = buildUnit({ routed: true, position: { row: 2, col: 1 }, movePoints: 5 });
    const state = createActiveBattle();
    state.phase = BATTLE_PHASE.ACTIVE;
    state.units = [unit];
    state.activeGroup = { side: "attacker", type: "cavalry" };
    state.activeUnitId = unit.id;
    state.round = 1;
    const map = buildMap();

    routTick(state, map);

    assert.strictEqual(unit.position, null);
    assert.strictEqual(unit.routed, true);
    assert.strictEqual(state.round, 2);
  });

  test("a routed unit with no MP does not move, but still ends its activation", () => {
    const unit = buildUnit({ routed: true, position: { row: 2, col: 1 }, movePoints: 0 });
    const state = createActiveBattle();
    state.phase = BATTLE_PHASE.ACTIVE;
    state.units = [unit];
    state.activeGroup = { side: "attacker", type: "cavalry" };
    state.activeUnitId = unit.id;
    state.round = 1;
    const map = buildMap();

    routTick(state, map);

    assert.deepStrictEqual(unit.position, { row: 2, col: 1 });
    assert.strictEqual(state.round, 2);
  });

  test("a non-routed active unit just ends its activation without moving", () => {
    const unit = buildUnit({ routed: false, position: { row: 2, col: 1 }, movePoints: 5 });
    const state = createActiveBattle();
    state.phase = BATTLE_PHASE.ACTIVE;
    state.units = [unit];
    state.activeGroup = { side: "attacker", type: "cavalry" };
    state.activeUnitId = unit.id;
    state.round = 1;
    const map = buildMap();

    routTick(state, map);

    assert.deepStrictEqual(unit.position, { row: 2, col: 1 });
    assert.strictEqual(state.round, 2);
  });
});

// bigger map for ranged geometry: attacker at {2,2} facing 0 (east) has its two
// front edge dirs at 0 (E) and 1 (NE); {2,4} is 2 hexes straight east (in the
// frontal cone, reach 2), {2,0} is 2 hexes straight west (rear, out of cone).
const buildWideMap = (overrides = {}) => {
  const cells = [
    ["plain", "plain", "plain", "plain", "plain"],
    ["plain", "plain", "plain", "plain", "plain"],
    ["plain", "plain", "plain", "plain", "plain"],
  ];
  for (const [key, terrain] of Object.entries(overrides)) {
    const [row, col] = key.split(":").map(Number);
    cells[row][col] = terrain;
  }
  return { id: 2, name: "wide", width: 5, height: 3, cells };
};

const buildRangedAttacker = (overrides = {}) => buildUnit({
  id: 1,
  side: "attacker",
  type: "archer",
  position: { row: 2, col: 2 },
  facing: 0,
  attack: 20,
  hp: 100,
  maxHp: 100,
  movePoints: 5,
  ammo: 8,
  cooldown: 0,
  ...overrides,
});

// facing 3 puts the attacker (2 hexes due east) squarely in this target's
// FRONT zone at range; facing 1 puts it in FLANK (see zoneAtRange tests)
const buildRangedTarget = (overrides = {}) => buildUnit({
  id: 2,
  side: "defender",
  type: "light-cavalry",
  position: { row: 2, col: 4 },
  facing: 3,
  hp: 100,
  maxHp: 100,
  morale: 80,
  ...overrides,
});

describe("ranged attack", () => {
  test("arc fire ignores an intervening friendly unit", () => {
    const attacker = buildRangedAttacker();
    const target = buildRangedTarget();
    const friendly = buildUnit({ id: 3, side: "attacker", position: { row: 2, col: 3 } });
    const state = makeActiveState(attacker, [target, friendly]);
    const map = buildWideMap();

    attack(state, target.id, map, "arc");

    assert.ok(target.hp < 100);
    assert.ok(target.morale < 80);
    assert.strictEqual(attacker.ammo, 7);
  });

  test("direct fire is blocked by an intervening unit", () => {
    const attacker = buildRangedAttacker();
    const target = buildRangedTarget();
    const friendly = buildUnit({ id: 3, side: "attacker", position: { row: 2, col: 3 } });
    const state = makeActiveState(attacker, [target, friendly]);
    const map = buildWideMap();

    attack(state, target.id, map, "direct");

    assert.strictEqual(target.hp, 100);
    assert.strictEqual(target.morale, 80);
    assert.strictEqual(attacker.ammo, 8);
  });

  test("direct fire hits with clear line of sight", () => {
    const attacker = buildRangedAttacker();
    const target = buildRangedTarget();
    const state = makeActiveState(attacker, [target]);
    const map = buildWideMap();

    attack(state, target.id, map, "direct");

    assert.ok(target.hp < 100);
    assert.ok(target.morale < 80);
    assert.strictEqual(attacker.ammo, 7);
  });

  test("arc fire cannot target a unit on settlement terrain, direct fire still can", () => {
    const arcAttacker = buildRangedAttacker();
    const arcTarget = buildRangedTarget();
    const arcState = makeActiveState(arcAttacker, [arcTarget]);
    const arcMap = buildWideMap({ "2:4": "settlement" });

    attack(arcState, arcTarget.id, arcMap, "arc");

    assert.strictEqual(arcTarget.hp, 100);
    assert.strictEqual(arcAttacker.ammo, 8);

    const directAttacker = buildRangedAttacker();
    const directTarget = buildRangedTarget();
    const directState = makeActiveState(directAttacker, [directTarget]);
    const directMap = buildWideMap({ "2:4": "settlement" });

    attack(directState, directTarget.id, directMap, "direct");

    assert.ok(directTarget.hp < 100);
    assert.strictEqual(directAttacker.ammo, 7);
  });

  test("out of ammo blocks arc and direct, but melee still works and leaves ammo untouched", () => {
    const attacker = buildRangedAttacker({ ammo: 0 });
    const target = buildRangedTarget({ position: { row: 2, col: 3 } });
    const state = makeActiveState(attacker, [target]);
    const map = buildWideMap();

    attack(state, target.id, map, "arc");
    assert.strictEqual(target.hp, 100);

    attack(state, target.id, map, "direct");
    assert.strictEqual(target.hp, 100);

    attack(state, target.id, map, "melee");
    assert.ok(target.hp < 100);
    assert.strictEqual(attacker.ammo, 0);
  });

  test("frontal cone: a target behind the attacker cannot be arc'd or direct-fired", () => {
    const attacker = buildRangedAttacker();
    const target = buildRangedTarget({ position: { row: 2, col: 0 } });
    const state = makeActiveState(attacker, [target]);
    const map = buildWideMap();

    attack(state, target.id, map, "arc");
    assert.strictEqual(target.hp, 100);

    attack(state, target.id, map, "direct");
    assert.strictEqual(target.hp, 100);
  });

  test("flank hit at range deals more morale damage than a front hit at the same range", () => {
    const frontAttacker = buildRangedAttacker();
    const frontTarget = buildRangedTarget({ facing: 3 });
    const frontState = makeActiveState(frontAttacker, [frontTarget]);
    attack(frontState, frontTarget.id, buildWideMap(), "direct");

    const flankAttacker = buildRangedAttacker();
    const flankTarget = buildRangedTarget({ facing: 1 });
    const flankState = makeActiveState(flankAttacker, [flankTarget]);
    attack(flankState, flankTarget.id, buildWideMap(), "direct");

    const frontMoraleDamage = 80 - frontTarget.morale;
    const flankMoraleDamage = 80 - flankTarget.morale;
    assert.ok(flankMoraleDamage > frontMoraleDamage);
    assert.strictEqual(100 - frontTarget.hp, 100 - flankTarget.hp);
  });

  test("melee against a ranged-type defender deals 1.5x the morale damage of an identical hit on a non-ranged defender", () => {
    const meleeAttacker = buildAttacker();
    const archerTarget = buildTarget({ type: "archer" });
    const archerState = makeActiveState(meleeAttacker, [archerTarget]);
    attack(archerState, archerTarget.id, buildMap());

    const meleeAttacker2 = buildAttacker();
    const cavalryTarget = buildTarget({ type: "light-cavalry" });
    const cavalryState = makeActiveState(meleeAttacker2, [cavalryTarget]);
    attack(cavalryState, cavalryTarget.id, buildMap());

    const archerMoraleDamage = 80 - archerTarget.morale;
    const cavalryMoraleDamage = 80 - cavalryTarget.morale;
    assert.strictEqual(archerMoraleDamage, cavalryMoraleDamage * 1.5);
  });

  test("validRangedTargets / fireModesAvailable reflect a direct shot in range with clear LoS", () => {
    const attacker = buildRangedAttacker();
    const target = buildRangedTarget();
    const state = makeActiveState(attacker, [target]);
    const map = buildWideMap();

    assert.strictEqual(fireModesAvailable(state, map).direct, true);
    assert.ok(validRangedTargets(state, map, "direct").includes(target.id));
  });
});

describe("crossbow cooldown", () => {
  test("firing direct decrements ammo and sets cooldown", () => {
    const attacker = buildRangedAttacker({ type: "crossbowman", ammo: 8, cooldown: 0 });
    const target = buildRangedTarget({ position: { row: 2, col: 3 } });
    const state = makeActiveState(attacker, [target]);
    const map = buildWideMap();

    attack(state, target.id, map, "direct");

    assert.strictEqual(attacker.ammo, 7);
    assert.strictEqual(attacker.cooldown, 2);
  });

  test("a nonzero cooldown blocks direct fire", () => {
    const attacker = buildRangedAttacker({ type: "crossbowman", ammo: 8, cooldown: 1, hasAttacked: false });
    const target = buildRangedTarget({ position: { row: 2, col: 3 } });
    const state = makeActiveState(attacker, [target]);
    const map = buildWideMap();

    attack(state, target.id, map, "direct");

    assert.strictEqual(target.hp, 100);
    assert.strictEqual(attacker.ammo, 8);
  });

  test("beginActivation ticks cooldown down by 1 each activation", () => {
    const unit = buildUnit({ type: "crossbowman", cooldown: 2, movePoints: 3 });
    const state = createActiveBattle();
    state.phase = BATTLE_PHASE.ACTIVE;
    state.units = [unit];
    state.activeGroup = { side: "attacker", type: "archers" };
    state.activeUnitId = unit.id;
    state.round = 1;
    const map = buildMap();

    // single-unit, single-group battle: the group wraps back to this unit
    // within one endActivation call, invoking beginActivation on it again
    endActivation(state, map);

    assert.strictEqual(unit.cooldown, 1);
  });
});

// taller map for charge-accumulation / breakthrough-push geometry, which needs
// hexes beyond the 3x3 grid used elsewhere
const buildTallMap = (overrides = {}) => {
  const cells = [
    ["plain", "plain", "plain"],
    ["plain", "plain", "plain"],
    ["plain", "plain", "plain"],
    ["plain", "plain", "plain"],
    ["plain", "plain", "plain"],
  ];
  for (const [key, terrain] of Object.entries(overrides)) {
    const [row, col] = key.split(":").map(Number);
    cells[row][col] = terrain;
  }
  return { id: 3, name: "tall", width: 3, height: 5, cells };
};

describe("charge accumulation (M6)", () => {
  test("consecutive front advances increment chargeHexes; rotation resets it", () => {
    const unit = buildUnit({ position: { row: 1, col: 1 }, facing: 4, movePoints: 10 });
    const state = makeActiveState(unit);
    const map = buildTallMap();

    advanceUnit(state, { row: 2, col: 1 }, map);
    assert.strictEqual(unit.chargeHexes, 1);

    advanceUnit(state, { row: 3, col: 1 }, map);
    assert.strictEqual(unit.chargeHexes, 2);

    rotateUnit(state, 2);
    assert.strictEqual(unit.chargeHexes, 0);

    rotateUnit(state, 4);
    advanceUnit(state, { row: 4, col: 1 }, map);
    assert.strictEqual(unit.chargeHexes, 1);
  });
});

describe("spearman flank/rear moves (M6)", () => {
  test("a spearman may advance into a flank hex at 2x MP cost and resets its charge", () => {
    const unit = buildUnit({
      type: "light-spearman",
      position: { row: 1, col: 1 },
      facing: 4,
      movePoints: 4,
      chargeHexes: 2
    });
    const state = makeActiveState(unit);
    const map = buildMap();

    advanceUnit(state, { row: 1, col: 0 }, map);

    assert.deepStrictEqual(unit.position, { row: 1, col: 0 });
    assert.strictEqual(unit.chargeHexes, 0);
    assert.strictEqual(unit.movePoints, 2);
  });

  test("a non-spearman cannot advance into a flank hex", () => {
    const unit = buildUnit({ position: { row: 1, col: 1 }, facing: 4, movePoints: 4 });
    const state = makeActiveState(unit);
    const map = buildMap();

    advanceUnit(state, { row: 1, col: 0 }, map);

    assert.deepStrictEqual(unit.position, { row: 1, col: 1 });
    assert.strictEqual(unit.movePoints, 4);
  });
});

describe("charge damage (M6)", () => {
  test("a charging light-cavalry deals ram-boosted front damage", () => {
    const attacker = buildAttacker({ attack: 10, chargeHexes: 2 });
    const target = buildTarget({ facing: 1 });
    const state = makeActiveState(attacker, [target]);

    attack(state, target.id, buildMap());

    assert.strictEqual(target.hp, 100 - 12);
    assert.strictEqual(target.morale, 80 - 12);
  });

  test("charge morale bonus at >=3 hexes is exempt from the x3 cap while HP stays capped", () => {
    const attacker = buildAttacker({ type: "heavy-cavalry", attack: 5, chargeHexes: 10 });
    const target = buildTarget({ facing: 1 });
    const state = makeActiveState(attacker, [target]);

    attack(state, target.id, buildMap());

    assert.strictEqual(100 - target.hp, 15);
    assert.strictEqual(80 - target.morale, 21);
  });

  test("beginActivation resets chargeHexes on the next activation", () => {
    const unit = buildUnit({ chargeHexes: 3, movePoints: 3 });
    const state = createActiveBattle();
    state.phase = BATTLE_PHASE.ACTIVE;
    state.units = [unit];
    state.activeGroup = { side: "attacker", type: "cavalry" };
    state.activeUnitId = unit.id;
    state.round = 1;
    const map = buildMap();

    // single-unit, single-group battle: the group wraps back to this unit
    // within one endActivation call, invoking beginActivation on it again
    endActivation(state, map);

    assert.strictEqual(unit.chargeHexes, 0);
  });
});

describe("maneuver (M6)", () => {
  test("a maneuverable unit may advance into an empty front hex after attacking", () => {
    const attacker = buildAttacker({ attack: 1 });
    const target = buildTarget({ hp: 500, maxHp: 500 });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap();

    attack(state, target.id, map);
    assert.strictEqual(attacker.hasAttacked, true);

    advanceUnit(state, { row: 2, col: 2 }, map);

    assert.deepStrictEqual(attacker.position, { row: 2, col: 2 });
  });

  test("a non-maneuverable unit cannot advance after attacking", () => {
    const attacker = buildAttacker({ type: "medium-spearman", attack: 1 });
    const target = buildTarget({ hp: 500, maxHp: 500 });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap();

    attack(state, target.id, map);
    assert.strictEqual(attacker.hasAttacked, true);

    advanceUnit(state, { row: 2, col: 2 }, map);

    assert.deepStrictEqual(attacker.position, { row: 1, col: 1 });
  });
});

describe("closed formation (M6)", () => {
  test("one covered flank reduces incoming front damage to x0.8", () => {
    const attacker = buildAttacker();
    const target = buildTarget({ type: "medium-spearman", facing: 1 });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap({ "2:2": "mountain" });

    attack(state, target.id, map);

    assert.strictEqual(100 - target.hp, 16);
  });

  test("both covered flanks reduce incoming front damage to x0.6", () => {
    const attacker = buildAttacker();
    const target = buildTarget({ type: "medium-spearman", facing: 1 });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap({ "2:2": "mountain", "2:0": "mountain" });

    attack(state, target.id, map);

    assert.strictEqual(100 - target.hp, 12);
  });

  test("no cover leaves front damage unmodified", () => {
    const attacker = buildAttacker();
    const target = buildTarget({ type: "medium-spearman", facing: 1 });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap();

    attack(state, target.id, map);

    assert.strictEqual(100 - target.hp, 20);
  });
});

describe("spearman rear physical bonus (M6)", () => {
  test("a rear hit on a spearman deals 1.5x HP damage compared to a non-spearman", () => {
    const spearAttacker = buildAttacker();
    const spearTarget = buildTarget({ type: "medium-spearman" }); // facing 4 -> rear
    const spearState = makeActiveState(spearAttacker, [spearTarget]);
    attack(spearState, spearTarget.id, buildMap());

    const infAttacker = buildAttacker();
    const infTarget = buildTarget({ type: "medium-infantry" }); // facing 4 -> rear
    const infState = makeActiveState(infAttacker, [infTarget]);
    attack(infState, infTarget.id, buildMap());

    assert.strictEqual(100 - spearTarget.hp, 30);
    assert.strictEqual(100 - infTarget.hp, 20);
    assert.ok((100 - spearTarget.hp) > (100 - infTarget.hp));
  });
});

describe("shock infantry rear-to-flank morale downgrade (M6)", () => {
  test("a shock-infantry rear hit uses the flank (1.25x) morale multiplier, not rear (1.5x)", () => {
    const shockAttacker = buildAttacker({ type: "light-infantry" });
    const shockTarget = buildTarget({ type: "medium-cavalry" }); // facing 4 -> rear
    const shockState = makeActiveState(shockAttacker, [shockTarget]);
    attack(shockState, shockTarget.id, buildMap());

    const plainAttacker = buildAttacker({ type: "light-cavalry" });
    const plainTarget = buildTarget({ type: "medium-cavalry" }); // facing 4 -> rear
    const plainState = makeActiveState(plainAttacker, [plainTarget]);
    attack(plainState, plainTarget.id, buildMap());

    const shockMorale = 80 - shockTarget.morale;
    const plainMorale = 80 - plainTarget.morale;
    assert.ok(shockMorale < plainMorale);
  });
});

describe("breakthrough (M6)", () => {
  test("a front hit that drops hp >= target.attack arms a breakthrough with the correct push", () => {
    const attacker = buildAttacker({ type: "light-infantry", attack: 30 });
    const target = buildTarget({ facing: 1, attack: 10 });
    const state = makeActiveState(attacker, [target]);
    const map = buildTallMap();

    attack(state, target.id, map);

    assert.deepStrictEqual(state.pendingBreakthrough, { attackerId: attacker.id, targetId: target.id, pushDir: 4 });
  });

  test("applying a breakthrough pushes the target and moves the attacker into its hex", () => {
    const attacker = buildAttacker({ type: "light-infantry", attack: 30 });
    const target = buildTarget({ facing: 1, attack: 10 });
    const state = makeActiveState(attacker, [target]);
    const map = buildTallMap();
    attack(state, target.id, map);

    applyBreakthrough(state, map);

    assert.strictEqual(state.pendingBreakthrough, null);
    assert.deepStrictEqual(target.position, { row: 3, col: 0 });
    assert.deepStrictEqual(attacker.position, { row: 2, col: 1 });
  });

  test("a breakthrough chain pushes every unit in the line", () => {
    const attacker = buildAttacker({ type: "light-infantry", attack: 30 });
    const target = buildTarget({ facing: 1, attack: 10 });
    const behind = buildUnit({ id: 3, side: "defender", position: { row: 3, col: 0 } });
    const state = makeActiveState(attacker, [target, behind]);
    const map = buildTallMap();
    attack(state, target.id, map);

    applyBreakthrough(state, map);

    assert.deepStrictEqual(target.position, { row: 3, col: 0 });
    assert.deepStrictEqual(behind.position, { row: 4, col: 0 });
    assert.deepStrictEqual(attacker.position, { row: 2, col: 1 });
  });

  test("a breakthrough is not armed when the landing hex is off-map", () => {
    const attacker = buildAttacker({ type: "light-infantry", attack: 30 });
    const target = buildTarget({ facing: 1, attack: 10 });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap(); // 3x3: {3,0} is off-map

    attack(state, target.id, map);

    assert.strictEqual(state.pendingBreakthrough, null);
  });

  test("a breakthrough is not armed when the dealt hp is below the target's attack stat", () => {
    const attacker = buildAttacker({ type: "light-infantry", attack: 1 });
    const target = buildTarget({ facing: 1, attack: 50 });
    const state = makeActiveState(attacker, [target]);
    const map = buildTallMap();

    attack(state, target.id, map);

    assert.strictEqual(state.pendingBreakthrough, null);
  });

  test("declining a breakthrough clears it without moving anyone", () => {
    const attacker = buildAttacker({ type: "light-infantry", attack: 30 });
    const target = buildTarget({ facing: 1, attack: 10 });
    const state = makeActiveState(attacker, [target]);
    const map = buildTallMap();
    attack(state, target.id, map);

    declineBreakthrough(state);

    assert.strictEqual(state.pendingBreakthrough, null);
    assert.deepStrictEqual(attacker.position, { row: 1, col: 1 });
    assert.deepStrictEqual(target.position, { row: 2, col: 1 });
  });

  test("a pending breakthrough is dropped when the activation ends", () => {
    const attacker = buildAttacker({ type: "light-infantry", attack: 30 });
    const target = buildTarget({ facing: 1, attack: 10 });
    const state = makeActiveState(attacker, [target]);
    state.activeGroup = { side: "attacker", type: "shock-infantry" };
    const map = buildTallMap();
    attack(state, target.id, map);
    assert.notStrictEqual(state.pendingBreakthrough, null);

    endActivation(state, map);

    assert.strictEqual(state.pendingBreakthrough, null);
  });
});

describe("charge reflection (M6)", () => {
  test("a charging attacker hitting a spearman's covered front takes back the dealt hp", () => {
    const attacker = buildAttacker({ chargeHexes: 1 });
    const target = buildTarget({ type: "medium-spearman", facing: 1 });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap({ "2:2": "mountain" });

    attack(state, target.id, map);

    assert.strictEqual(attacker.hp, 100 - 17);
    assert.ok(state.log.some((line) => line.includes("отражает")));
  });

  test("no reflection without a charge", () => {
    const attacker = buildAttacker({ chargeHexes: 0 });
    const target = buildTarget({ type: "medium-spearman", facing: 1 });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap({ "2:2": "mountain" });

    attack(state, target.id, map);

    assert.strictEqual(attacker.hp, 100);
  });

  test("no reflection without covered flanks", () => {
    const attacker = buildAttacker({ chargeHexes: 1 });
    const target = buildTarget({ type: "medium-spearman", facing: 1 });
    const state = makeActiveState(attacker, [target]);
    const map = buildMap();

    attack(state, target.id, map);

    assert.strictEqual(attacker.hp, 100);
  });

  test("no reflection on a non-front hit", () => {
    const attacker = buildAttacker({ chargeHexes: 1 });
    const target = buildTarget({ type: "medium-spearman" }); // facing 4 -> rear
    const state = makeActiveState(attacker, [target]);
    const map = buildMap({ "2:2": "mountain" });

    attack(state, target.id, map);

    assert.strictEqual(attacker.hp, 100);
  });
});

describe("reset clears pendingBreakthrough (M6)", () => {
  test("reset returns pendingBreakthrough to null along with everything else", () => {
    const state = createActiveBattle();
    state.pendingBreakthrough = { attackerId: 1, targetId: 2, pushDir: 4 };

    resetActiveBattle(state);

    assert.deepStrictEqual(state, PRISTINE);
  });
});

describe("horse archer hill exclusion (M6)", () => {
  test("gets no elevation range bonus: distance 3 from a hill misses with arc range 2", () => {
    const attacker = buildRangedAttacker({ type: "horse-archer", position: { row: 2, col: 1 } });
    const target = buildRangedTarget();
    const state = makeActiveState(attacker, [target]);
    const map = buildWideMap({ "2:1": "hills" });

    attack(state, target.id, map, "arc");

    assert.strictEqual(target.hp, 100);
    assert.strictEqual(attacker.ammo, 8);
  });

  test("gets no elevation damage bonus, while a regular archer does", () => {
    const horse = buildRangedAttacker({ type: "horse-archer" });
    const horseTarget = buildRangedTarget();
    const horseState = makeActiveState(horse, [horseTarget]);
    attack(horseState, horseTarget.id, buildWideMap({ "2:2": "hills" }), "arc");
    assert.strictEqual(horseTarget.hp, 80); // 20 × arc 1 × clamped elev 1

    const archer = buildRangedAttacker();
    const archerTarget = buildRangedTarget();
    const archerState = makeActiveState(archer, [archerTarget]);
    attack(archerState, archerTarget.id, buildWideMap({ "2:2": "hills" }), "arc");
    assert.strictEqual(archerTarget.hp, 70); // 20 × arc 1 × elev 1.5 (hills are elevation 2)
  });

  test("still takes the uphill penalty when firing at a target on high ground", () => {
    const attacker = buildRangedAttacker({ type: "horse-archer" });
    const target = buildRangedTarget();
    const state = makeActiveState(attacker, [target]);

    attack(state, target.id, buildWideMap({ "2:4": "hills" }), "arc");

    assert.strictEqual(target.hp, 90); // 20 × arc 1 × elev 0.5 (firing 2 levels uphill)
  });
});

describe("validRangedTargets after attacking", () => {
  test("returns no targets once the active unit has attacked", () => {
    const attacker = buildRangedAttacker();
    const target = buildRangedTarget();
    const state = makeActiveState(attacker, [target]);
    const map = buildWideMap();

    assert.deepStrictEqual(validRangedTargets(state, map, "arc"), [target.id]);

    attack(state, target.id, map, "arc");

    assert.deepStrictEqual(validRangedTargets(state, map, "arc"), []);
  });
});

describe("opportunity arming (M7)", () => {
  test("advancing into an adjacent enemy's zone arms a reaction", () => {
    const mover = buildUnit({
      id: 1,
      side: "attacker",
      type: "light-cavalry",
      position: { row: 1, col: 1 },
      facing: 4,
      movePoints: 5
    });
    const enemy = buildUnit({
      id: 2,
      side: "defender",
      type: "medium-infantry",
      position: { row: 2, col: 0 },
      facing: 1
    });
    const state = makeActiveState(mover, [enemy]);
    state.round = 1;
    const map = buildMap();

    advanceUnit(state, { row: 2, col: 1 }, map);

    assert.deepStrictEqual(mover.position, { row: 2, col: 1 });
    assert.deepStrictEqual(state.pendingOpportunity, { queue: [2], targetId: 1 });
  });

  test("no arming when the mover was already in the zone before the move", () => {
    const mover = buildUnit({
      id: 1,
      side: "attacker",
      type: "light-cavalry",
      position: { row: 1, col: 1 },
      facing: 4,
      movePoints: 5
    });
    const enemy = buildUnit({
      id: 2,
      side: "defender",
      type: "medium-infantry",
      position: { row: 2, col: 2 },
      facing: 1
    });
    const state = makeActiveState(mover, [enemy]);
    state.round = 1;
    const map = buildMap();

    advanceUnit(state, { row: 2, col: 1 }, map);

    assert.strictEqual(state.pendingOpportunity, null);
  });

  test("no arming for an enemy that already attacked this round", () => {
    const mover = buildUnit({
      id: 1,
      side: "attacker",
      type: "light-cavalry",
      position: { row: 1, col: 1 },
      facing: 4,
      movePoints: 5
    });
    const enemy = buildUnit({
      id: 2, side: "defender", type: "medium-infantry", position: { row: 2, col: 0 }, facing: 1, attackedRound: 1,
    });
    const state = makeActiveState(mover, [enemy]);
    state.round = 1;
    const map = buildMap();

    advanceUnit(state, { row: 2, col: 1 }, map);

    assert.strictEqual(state.pendingOpportunity, null);
  });
});

describe("opportunity resolution (M7)", () => {
  test("the reaction resolves on the mover's next action and cuts the mover's hp", () => {
    const mover = buildUnit({
      id: 1,
      side: "attacker",
      type: "light-cavalry",
      position: { row: 1, col: 1 },
      facing: 4,
      movePoints: 5,
      hp: 100,
      maxHp: 100
    });
    const opp = buildUnit({
      id: 2,
      side: "defender",
      type: "medium-infantry",
      position: { row: 2, col: 0 },
      facing: 1,
      attack: 20
    });
    const state = makeActiveState(mover, [opp]);
    state.round = 1;
    const map = buildMap();
    advanceUnit(state, { row: 2, col: 1 }, map);

    rotateUnit(state, 2, map);

    assert.ok(mover.hp < 100);
    assert.strictEqual(state.pendingOpportunity, null);
    assert.strictEqual(opp.reactedRound, 1);
    assert.strictEqual(opp.attackedRound, 1);
    assert.strictEqual(mover.facing, 2);
  });

  test("ending the activation cancels the reaction", () => {
    const mover = buildUnit({
      id: 1,
      side: "attacker",
      type: "light-cavalry",
      position: { row: 1, col: 1 },
      facing: 4,
      movePoints: 5,
      hp: 100,
      maxHp: 100
    });
    const opp = buildUnit({
      id: 2,
      side: "defender",
      type: "medium-infantry",
      position: { row: 2, col: 0 },
      facing: 1,
      attack: 20
    });
    const state = makeActiveState(mover, [opp]);
    state.round = 1;
    state.activeGroup = { side: "attacker", type: "cavalry" };
    const map = buildMap();
    advanceUnit(state, { row: 2, col: 1 }, map);

    endActivation(state, map);

    assert.strictEqual(state.pendingOpportunity, null);
    assert.strictEqual(mover.hp, 100);
    assert.strictEqual(opp.reactedRound, null);
  });

  test("a reaction that destroys the mover does not crash a later accelerate", () => {
    const mover = buildUnit({
      id: 1,
      side: "attacker",
      type: "light-cavalry",
      position: { row: 1, col: 1 },
      facing: 4,
      movePoints: 5,
      hp: 1,
      maxHp: 100
    });
    const opp = buildUnit({
      id: 2,
      side: "defender",
      type: "medium-infantry",
      position: { row: 2, col: 0 },
      facing: 1,
      attack: 20
    });
    const state = makeActiveState(mover, [opp]);
    state.round = 1;
    const map = buildMap();
    advanceUnit(state, { row: 2, col: 1 }, map);

    assert.doesNotThrow(() => accelerate(state, map));

    assert.strictEqual(mover.destroyed, true);
    assert.strictEqual(mover.position, null);
    assert.strictEqual(mover.accelerated, false);
  });

  test("a reaction that destroys the mover leaves it untouched by a later rotateUnit", () => {
    const mover = buildUnit({
      id: 1,
      side: "attacker",
      type: "light-cavalry",
      position: { row: 1, col: 1 },
      facing: 4,
      movePoints: 5,
      hp: 1,
      maxHp: 100
    });
    const opp = buildUnit({
      id: 2,
      side: "defender",
      type: "medium-infantry",
      position: { row: 2, col: 0 },
      facing: 1,
      attack: 20
    });
    const state = makeActiveState(mover, [opp]);
    state.round = 1;
    const map = buildMap();
    advanceUnit(state, { row: 2, col: 1 }, map);

    rotateUnit(state, 2, map);

    assert.strictEqual(mover.destroyed, true);
    assert.strictEqual(mover.facing, 4);
    assert.ok(!state.log.some((line) => line.includes("разворачивается")));
  });
});

describe("opportunity strike-first (M7)", () => {
  test("the mover attacking the opportuner strikes first and can kill it before it reacts", () => {
    const mover = buildUnit({
      id: 1,
      side: "attacker",
      type: "light-cavalry",
      position: { row: 1, col: 1 },
      facing: 4,
      movePoints: 5,
      hp: 100,
      maxHp: 100,
      attack: 20
    });
    const opp = buildUnit({
      id: 2,
      side: "defender",
      type: "medium-infantry",
      position: { row: 2, col: 0 },
      facing: 1,
      hp: 10,
      maxHp: 100
    });
    const state = makeActiveState(mover, [opp]);
    state.round = 1;
    const map = buildMap();
    advanceUnit(state, { row: 2, col: 1 }, map);

    attack(state, opp.id, map);

    assert.strictEqual(opp.destroyed, true);
    assert.strictEqual(mover.hp, 100);
  });

  test("if the opportuner survives the mover's strike it then reacts", () => {
    const mover = buildUnit({
      id: 1,
      side: "attacker",
      type: "light-cavalry",
      position: { row: 1, col: 1 },
      facing: 4,
      movePoints: 5,
      hp: 100,
      maxHp: 100,
      attack: 20
    });
    const opp = buildUnit({
      id: 2,
      side: "defender",
      type: "medium-infantry",
      position: { row: 2, col: 0 },
      facing: 1,
      hp: 200,
      maxHp: 200
    });
    const state = makeActiveState(mover, [opp]);
    state.round = 1;
    const map = buildMap();
    advanceUnit(state, { row: 2, col: 1 }, map);

    attack(state, opp.id, map);

    assert.ok(opp.hp < 200);
    assert.strictEqual(opp.destroyed, false);
    assert.ok(mover.hp < 100);
  });
});

describe("opportunity rotate-only slot (M7)", () => {
  test("a unit that reacted this round may only rotate on its own slot", () => {
    const active = buildUnit({
      id: 1,
      side: "defender",
      type: "medium-infantry",
      position: { row: 2, col: 1 },
      facing: 1,
      movePoints: 5,
      morale: 80,
      reactedRound: 1,
    });
    const dummy = buildUnit({ id: 2, side: "attacker", position: { row: 2, col: 0 }, hp: 50 });
    const state = makeActiveState(active, [dummy]);
    state.round = 1;
    const map = buildMap();

    advanceUnit(state, { row: 1, col: 1 }, map);
    assert.deepStrictEqual(active.position, { row: 2, col: 1 });

    attack(state, dummy.id, map);
    assert.strictEqual(dummy.hp, 50);
    assert.strictEqual(active.hasAttacked, false);

    accelerate(state, map);
    assert.strictEqual(active.movePoints, 5);
    assert.strictEqual(active.morale, 80);

    rotateUnit(state, 3, map);
    assert.strictEqual(active.facing, 3);
  });
});

describe("opportunity multi-enemy order (M7)", () => {
  test("multiple newly-entered enemies queue in ascending id order and all react", () => {
    const mover = buildUnit({
      id: 1,
      side: "attacker",
      type: "light-cavalry",
      position: { row: 1, col: 1 },
      facing: 4,
      movePoints: 5,
      hp: 100,
      maxHp: 100
    });
    const oppA = buildUnit({
      id: 2,
      side: "defender",
      type: "medium-infantry",
      position: { row: 2, col: 0 },
      attack: 15
    });
    const oppB = buildUnit({
      id: 3,
      side: "defender",
      type: "medium-infantry",
      position: { row: 3, col: 1 },
      attack: 15
    });
    const state = makeActiveState(mover, [oppA, oppB]);
    state.round = 1;
    const map = buildTallMap();

    advanceUnit(state, { row: 2, col: 1 }, map);

    assert.deepStrictEqual(state.pendingOpportunity.queue, [2, 3]);

    rotateUnit(state, 2, map);

    assert.strictEqual(oppA.reactedRound, 1);
    assert.strictEqual(oppB.reactedRound, 1);
    assert.strictEqual(mover.hp, 70);
  });
});

describe("ruler aura (M7)", () => {
  test("rulerAuraBonus is 10 with a living on-field ruler, else 0", () => {
    const ruler = buildUnit({ id: 1, side: "defender", isRulerUnit: true, position: { row: 0, col: 0 } });
    const state = makeActiveState(ruler);

    assert.strictEqual(rulerAuraBonus(state, "defender"), 10);
    assert.strictEqual(rulerAuraBonus(state, "attacker"), 0);

    ruler.routed = true;
    assert.strictEqual(rulerAuraBonus(state, "defender"), 0);

    ruler.routed = false;
    ruler.destroyed = true;
    ruler.position = null;
    assert.strictEqual(rulerAuraBonus(state, "defender"), 0);

    const noRuler = buildUnit({ id: 2, side: "defender", isRulerUnit: false, position: { row: 0, col: 0 } });
    const noRulerState = makeActiveState(noRuler);
    assert.strictEqual(rulerAuraBonus(noRulerState, "defender"), 0);
  });

  test("effectiveMorale adds the aura", () => {
    const unit = buildUnit({ id: 1, side: "defender", morale: 5, position: { row: 1, col: 1 } });
    const ruler = buildUnit({ id: 2, side: "defender", isRulerUnit: true, position: { row: 0, col: 0 } });
    const state = makeActiveState(unit, [ruler]);

    assert.strictEqual(effectiveMorale(state, unit), 15);
  });

  test("the aura keeps a low-morale ally from routing", () => {
    const attacker = buildAttacker();
    const ally = buildTarget({ facing: 1, morale: 15, hp: 100 });
    const ruler = buildUnit({ id: 3, side: "defender", isRulerUnit: true, position: { row: 0, col: 0 }, hp: 100 });
    const state = makeActiveState(attacker, [ally, ruler]);

    attack(state, ally.id, buildMap());

    assert.strictEqual(ally.routed, false);
  });

  test("without the ruler's aura the same hit routs the ally", () => {
    const attacker = buildAttacker();
    const ally = buildTarget({ facing: 1, morale: 15, hp: 100 });
    const state = makeActiveState(attacker, [ally]);

    attack(state, ally.id, buildMap());

    assert.strictEqual(ally.routed, true);
  });

  test("destroying the ruler ends the aura and routs a now-unbuffered ally", () => {
    const attacker = buildAttacker();
    const ruler = buildUnit({
      id: 2,
      side: "defender",
      isRulerUnit: true,
      position: { row: 2, col: 1 },
      facing: 1,
      hp: 15,
      maxHp: 15
    });
    const ally = buildUnit({
      id: 3, side: "defender", position: { row: 0, col: 0 }, morale: -5, hp: 100, maxHp: 100,
    });
    const state = makeActiveState(attacker, [ruler, ally]);
    const map = buildMap();

    assert.strictEqual(effectiveMorale(state, ally), 5);

    attack(state, ruler.id, map);

    assert.strictEqual(ruler.destroyed, true);
    assert.strictEqual(ally.routed, true);
    assert.ok(state.log.some((line) => line.includes("аура окончена")));
  });
});

describe("reset clears pendingOpportunity (M7)", () => {
  test("reset returns pendingOpportunity to null along with everything else", () => {
    const state = createActiveBattle();
    state.pendingOpportunity = { queue: [2], targetId: 1 };

    resetActiveBattle(state);

    assert.strictEqual(state.pendingOpportunity, null);
    assert.deepStrictEqual(state, PRISTINE);
  });
});

describe("group cycle skips wiped-out groups", () => {
  test("a destroyed unit's group no longer activates — the round advances to the next fielded group", () => {
    // attacker shock-infantry vs defender archer (destroyed) + defender spearman
    const inf = buildUnit({
      id: 1,
      side: "attacker",
      type: "medium-infantry",
      position: { row: 1, col: 1 },
      facing: 4
    });
    const archer = buildUnit({ id: 2, side: "defender", type: "archer", position: null, destroyed: true, hp: 0 });
    const spear = buildUnit({
      id: 3,
      side: "defender",
      type: "light-spearman",
      position: { row: 2, col: 2 },
      facing: 1
    });
    const state = makeActiveState(inf, [archer, spear]);
    state.activeGroup = { side: "attacker", type: "shock-infantry" };
    const map = buildMap();

    // infantry's group is done; the dead archers group must be skipped entirely
    endActivation(state, map);

    assert.strictEqual(state.activeUnitId, 3);
    assert.deepStrictEqual(state.activeGroup, { side: "defender", type: "spearmen" });
  });
});
