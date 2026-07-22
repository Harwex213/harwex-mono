import { UNIT_TYPES } from "../data/unit.js";
import { DEFAULT_TERRAIN_ID, TERRAINS } from "../data/terrains.js";
import { computeUnitStats, SIDES } from "./battle-config.js";
import { advanceCost, effectiveSpeed } from "../lib/movement-cost.js";
import { unitActivationOrder } from "../lib/turn-order.js";
import {
  directionTo,
  flankHexes,
  frontalConeReach,
  HEX_ZONE,
  hexDistance,
  neighbor,
  zoneAtRange,
  zoneOf,
} from "../lib/hex-facing.js";
import {
  ACTIVE_UNIT_GROUP_TYPE,
  firstActiveUnitGroup,
  getUnitGroupType,
  nextActiveUnitGroup
} from "../lib/active-unit-group.js";
import { chargeDamageMult, elevationDamageMult, formationCoverMult, resolveAttack } from "../lib/damage.js";
import { fleePath } from "../lib/flee-path.js";
import { arcBlocked, directLosBlocked } from "../lib/line-of-sight.js";

const BATTLE_PHASE = {
  DISPOSITION: "disposition",
  ACTIVE: "active",
  FINISHED: "finished",
};

// vertex 4 = south (attacker faces the enemy deploying top rows),
// vertex 1 = north (defender faces the enemy deploying bottom rows)
const DEFAULT_FACING_BY_SIDE = { attacker: 4, defender: 1 };

/**
 * @param {ActiveBattleUnit} unit
 * @returns {UnitType | null}
 */
const unitTypeOf = (unit) => UNIT_TYPES.find((t) => t.type === unit.type) ?? null;

/**
 * @param {HexMap} map
 * @param {number} row
 * @param {number} col
 * @returns {TerrainDef}
 */
const terrainAt = (map, row, col) =>
  TERRAINS.find((t) => t.id === map.cells[row][col]) ?? TERRAINS.find((t) => t.id === DEFAULT_TERRAIN_ID);

/**
 * @param {ActiveBattle} state
 * @param {BattleConfigSide} side
 * @returns {number}
 */
const rulerAuraBonus = (state, side) => {
  const ruler = state.units.find(
    (u) => u.side === side && u.isRulerUnit && !u.destroyed && !u.routed && u.position !== null,
  );
  return ruler ? 10 : 0;
};

/**
 * Morale used for rout checks and UI: base morale + the side's living-ruler aura.
 * @param {ActiveBattle} state
 * @param {ActiveBattleUnit} unit
 * @returns {number}
 */
const effectiveMorale = (state, unit) => unit.morale + rulerAuraBonus(state, unit.side);

// a flank hex counts as covered if it is off the map edge, impassable terrain,
// or occupied by a same-side ally (plan simplification of the doc's stricter
// "same-facing spearman ally" rule)
/**
 * @param {ActiveBattle} state
 * @param {ActiveBattleUnit} unit
 * @param {HexMap} map
 * @returns {number} 0..2 covered flanks
 */
const flankCoverCount = (state, unit, map) => {
  let count = 0;
  for (const h of flankHexes(unit.position, unit.facing)) {
    const offEdge = h.row < 0 || h.row >= map.height || h.col < 0 || h.col >= map.width;
    if (offEdge) {
      count += 1;
      continue;
    }
    if (terrainAt(map, h.row, h.col).impassable) {
      count += 1;
      continue;
    }
    const occ = unitAt(state, h.row, h.col);
    if (occ && occ.side === unit.side) {
      count += 1;
    }
  }
  return count;
};

/**
 * Resets an activating unit's per-activation fields and seeds its MP for
 * this activation (effective speed on its current hex + carried remainder).
 * @param {ActiveBattle} state
 * @param {ActiveBattleUnit} unit
 * @param {HexMap} map
 */
const beginActivation = (state, unit, map) => {
  const type = unitTypeOf(unit);
  const terrain = terrainAt(map, unit.position.row, unit.position.col);
  unit.movePoints = effectiveSpeed(unit.speed, terrain, type) + unit.mpCarry;
  unit.mpCarry = 0;
  unit.hasAttacked = false;
  unit.accelerated = false;
  unit.freeRotationUsed = false;
  unit.cooldown = Math.max(0, (unit.cooldown ?? 0) - 1);
  unit.chargeHexes = 0;
  state.pendingBreakthrough = null;
};

/**
 * @returns {ActiveBattle}
 */
const createActiveBattle = () => ({
  /** `ACTIVE_BATTLE_PHASE`, or null while no battle has been started */
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
});

/**
 * @param {ActiveBattle} activeBattle
 * @param {BattleConfig} battleConfig
 * @param {ModifiersState} modifiers
 */
const startBattleDisposition = (activeBattle, battleConfig, modifiers) => {
  if (activeBattle.phase !== null) {
    return;
  }

  activeBattle.phase = BATTLE_PHASE.DISPOSITION;
  activeBattle.mapId = battleConfig.mapId;
  activeBattle.units = SIDES.flatMap((side) =>
    battleConfig[side].map((unit) => {
      const type = UNIT_TYPES.find((t) => t.id === unit.typeId);
      const stats = computeUnitStats(unit, modifiers);
      return {
        id: activeBattle.nextUnitId++,
        side,
        type: type.type,
        name: type.name,
        hp: stats.hp,
        maxHp: stats.hp,
        attack: stats.attack,
        morale: stats.morale,
        speed: type.speed,
        /** {row, col} once placed on the map */
        position: null,
        facing: DEFAULT_FACING_BY_SIDE[side],
        movePoints: 0,
        mpCarry: 0,
        hasAttacked: false,
        accelerated: false,
        freeRotationUsed: false,
        ammo: type.ranged?.shots ?? 0,
        cooldown: 0,
        routed: false,
        isRulerUnit: false,
        destroyed: false,
        chargeHexes: 0,
        attackedRound: null,
        reactedRound: null,
      };
    }),
  );
};

/**
 * @param {ActiveBattle} activeBattle
 * @param {number} unitId
 * @returns {ActiveBattleUnit | null}
 */
const findUnit = (activeBattle, unitId) => activeBattle.units.find((u) => u.id === unitId) ?? null;

/**
 * @param {ActiveBattle} activeBattle
 * @param {number} row
 * @param {number} col
 * @returns {ActiveBattleUnit | null}
 */
const unitAt = (activeBattle, row, col) => activeBattle.units.find(
  (u) => u.position?.row === row && u.position?.col === col
) ?? null;

/**
 * @param {ActiveBattle} activeBattle
 * @param {HexMap} map
 */
const startBattle = (activeBattle, map) => {
  if (activeBattle.phase !== BATTLE_PHASE.DISPOSITION) {
    return;
  }

  activeBattle.phase = BATTLE_PHASE.ACTIVE;
  activeBattle.round = 1;
  activeBattle.activeGroup = firstActiveUnitGroup(activeBattle.units);
  activeBattle.actedUnitIds = [];
  activeBattle.log = ["Раунд 1"];

  const order = unitActivationOrder(activeBattle.units, activeBattle.activeGroup);
  const first = order[0] ?? null;
  activeBattle.activeUnitId = first ? first.id : null;
  if (first) {
    beginActivation(activeBattle, first, map);
    activeBattle.log.push(`${first.name} активируется`);
  }
};

/**
 * @param {ActiveBattle} state
 * @param {{row: number, col: number}} targetPos
 * @param {HexMap} map
 */
const advanceUnit = (state, targetPos, map) => {
  if (state.pendingOpportunity && state.pendingOpportunity.targetId === state.activeUnitId) {
    resolveAllReactions(state, map);
  }
  const u = findUnit(state, state.activeUnitId);
  if (!u || u.routed) {
    return;
  }
  if (u.position === null) {
    return;
  }
  if (u.reactedRound === state.round) {
    return;
  }
  const type = unitTypeOf(u);
  if (u.hasAttacked && !type?.maneuverable) {
    return;
  }
  const zone = zoneOf(u.position, u.facing, targetPos);
  if (zone === null) {
    return;
  }
  const isFront = zone === HEX_ZONE.FRONT;
  const isSpearman = getUnitGroupType(u.type) === ACTIVE_UNIT_GROUP_TYPE.SPEARMEN;
  if (!isFront && !isSpearman) {
    return;
  }
  if (targetPos.row < 0 || targetPos.row >= map.height || targetPos.col < 0 || targetPos.col >= map.width) {
    return;
  }
  const toTerrain = terrainAt(map, targetPos.row, targetPos.col);
  if (toTerrain.impassable) {
    return;
  }
  if (unitAt(state, targetPos.row, targetPos.col)) {
    return;
  }
  const fromTerrain = terrainAt(map, u.position.row, u.position.col);
  let cost = advanceCost(fromTerrain, toTerrain, type);
  if (!isFront) {
    cost *= 2;
  }
  if (u.movePoints < cost) {
    return;
  }
  const fromPos = { row: u.position.row, col: u.position.col };
  u.movePoints -= cost;
  u.position = { row: targetPos.row, col: targetPos.col };
  if (isFront) {
    u.chargeHexes += 1;
  } else {
    u.chargeHexes = 0;
  }
  state.log.push(`${u.name} перемещается`);
  armOpportunities(state, u, fromPos, map);
};

/**
 * @param {ActiveBattle} state
 * @param {number} facing
 * @param {HexMap} map
 */
const rotateUnit = (state, facing, map) => {
  if (state.pendingOpportunity && state.pendingOpportunity.targetId === state.activeUnitId) {
    resolveAllReactions(state, map);
  }
  const u = findUnit(state, state.activeUnitId);
  if (!u || u.routed) {
    return;
  }
  if (u.position === null) {
    return;
  }
  if (!Number.isInteger(facing) || facing < 0 || facing > 5) {
    return;
  }
  if (facing === u.facing) {
    return;
  }
  const type = unitTypeOf(u);
  if (type?.heavy && !u.freeRotationUsed) {
    u.freeRotationUsed = true;
  } else {
    if (u.movePoints < 1) {
      return;
    }
    u.movePoints -= 1;
  }
  u.facing = facing;
  u.chargeHexes = 0;
  state.log.push(`${u.name} разворачивается`);
};

/**
 * @param {ActiveBattle} state
 * @param {HexMap} map
 */
const accelerate = (state, map) => {
  if (state.pendingOpportunity && state.pendingOpportunity.targetId === state.activeUnitId) {
    resolveAllReactions(state, map);
  }
  const u = findUnit(state, state.activeUnitId);
  if (!u || u.routed) {
    return;
  }
  if (u.position === null) {
    return;
  }
  if (u.reactedRound === state.round) {
    return;
  }
  if (u.accelerated) {
    return;
  }
  const type = unitTypeOf(u);
  const terrain = terrainAt(map, u.position.row, u.position.col);
  if (type?.terrainClass === "cavalry" && terrain.id === "forest") {
    return;
  }
  u.morale -= 10;
  u.movePoints *= 2;
  u.accelerated = true;
  state.log.push(`${u.name} ускоряется`);
};

/**
 * @param {ActiveBattle} state
 * @param {HexMap} map
 */
const endActivation = (state, map) => {
  state.pendingBreakthrough = null;
  state.pendingOpportunity = null;
  const cur = findUnit(state, state.activeUnitId);
  if (!cur) {
    return;
  }
  cur.mpCarry = cur.movePoints;
  if (!state.actedUnitIds.includes(cur.id)) {
    state.actedUnitIds.push(cur.id);
  }

  const order = unitActivationOrder(state.units, state.activeGroup);
  const next = order.find((o) => !state.actedUnitIds.includes(o.id));
  if (next) {
    state.activeUnitId = next.id;
    beginActivation(state, next, map);
    state.log.push(`${next.name} активируется`);
    return;
  }

  // groups cycle over on-field units only — destroyed/off-field units stay in
  // state.units for the loss report but must not keep an empty group alive
  // (an empty group would activate nobody and deadlock the battle); with no
  // one fielded at all the battle is over, any pool keeps the bookkeeping sane
  const fielded = state.units.filter((u) => u.position !== null && !u.destroyed);
  const pool = fielded.length > 0 ? fielded : state.units;
  const nextGroup = nextActiveUnitGroup(state.activeGroup, pool);
  const first = firstActiveUnitGroup(pool);
  if (nextGroup.side === first.side && nextGroup.type === first.type) {
    state.round += 1;
    state.log.push(`Раунд ${state.round}`);
  }
  state.activeGroup = nextGroup;
  state.actedUnitIds = [];

  const ng = unitActivationOrder(state.units, nextGroup);
  const f = ng[0] ?? null;
  state.activeUnitId = f ? f.id : null;
  if (f) {
    beginActivation(state, f, map);
    state.log.push(`${f.name} активируется`);
  }
};

/**
 * Return the battle to the pristine, no-battle shape so a new one can start.
 * @param {ActiveBattle} activeBattle
 */
const resetActiveBattle = (activeBattle) => {
  activeBattle.phase = null;
  activeBattle.mapId = null;
  activeBattle.units = [];
  activeBattle.nextUnitId = 1;
  activeBattle.round = 0;
  activeBattle.activeGroup = null;
  activeBattle.activeUnitId = null;
  activeBattle.actedUnitIds = [];
  activeBattle.log = [];
  activeBattle.winner = null;
  activeBattle.pendingBreakthrough = null;
  activeBattle.pendingOpportunity = null;
};

/**
 * @param {ActiveBattle} state
 * @param {ActiveBattleUnit} unit
 * @returns {{position: {row: number, col: number}, side: BattleConfigSide, isRuler: boolean} | null}
 */
const markLoss = (state, unit) => {
  if (!unit || unit.destroyed || unit.position === null) {
    return null;
  }
  const pos = unit.position;
  if (unit.hp <= 0) {
    unit.destroyed = true;
    unit.position = null;
    state.log.push(`${unit.name} уничтожен`);
    if (unit.isRulerUnit) {
      state.log.push(`Правитель пал — аура окончена (d3 offline)`);
    }
    return { position: pos, side: unit.side, isRuler: unit.isRulerUnit };
  }
  if (effectiveMorale(state, unit) <= 0 && !unit.routed) {
    unit.routed = true;
    state.log.push(`${unit.name} обращается в бегство`);
    if (unit.isRulerUnit) {
      state.log.push(`${unit.name} — правитель бежал, аура окончена`);
    }
    return { position: pos, side: unit.side, isRuler: unit.isRulerUnit };
  }
  return null;
};

/**
 * Morale shock on the lost unit's allies (doc §1.3): -10 at distance 1, -5 at
 * distance 2, doubled when the loss was the ruler's unit.
 * @param {ActiveBattle} state
 * @param {{position: {row: number, col: number}, side: BattleConfigSide, isRuler: boolean}} event
 * @returns {ActiveBattleUnit[]} allies whose morale changed
 */
const applyMoraleShock = (state, event) => {
  const affected = [];
  for (const ally of state.units) {
    if (ally.side !== event.side || ally.destroyed || ally.routed || ally.position === null) {
      continue;
    }
    const d = hexDistance(ally.position, event.position);
    let penalty = d === 1 ? 10 : d === 2 ? 5 : 0;
    if (penalty === 0) {
      continue;
    }
    if (event.isRuler) {
      penalty *= 2;
    }
    ally.morale -= penalty;
    affected.push(ally);
  }
  return affected;
};

/**
 * Runs the destroyed/routed cascade for `firstUnit`, then chains morale
 * shock through any allies it routs in turn.
 * @param {ActiveBattle} state
 * @param {ActiveBattleUnit} firstUnit
 */
const applyLossCascade = (state, firstUnit) => {
  const queue = [];
  const first = markLoss(state, firstUnit);
  if (first) {
    queue.push(first);
  }
  while (queue.length) {
    const ev = queue.shift();
    for (const ally of applyMoraleShock(state, ev)) {
      const chained = markLoss(state, ally);
      if (chained) {
        queue.push(chained);
      }
    }
    if (ev.isRuler) {
      // aura just vanished — re-evaluate every surviving ally under the now-lower effective morale
      for (const ally of state.units) {
        if (ally.side !== ev.side || ally.destroyed || ally.routed || ally.position === null) {
          continue;
        }
        const chained = markLoss(state, ally);
        if (chained) {
          queue.push(chained);
        }
      }
    }
  }
};

/**
 * Ends the battle when one side has no on-field fighters left.
 * @param {ActiveBattle} state
 */
const checkVictory = (state) => {
  if (state.phase !== BATTLE_PHASE.ACTIVE) {
    return;
  }
  const isFighter = (u, side) => u.side === side && !u.destroyed && !u.routed && u.position !== null;
  const attU = state.units.some((u) => isFighter(u, "attacker"));
  const defU = state.units.some((u) => isFighter(u, "defender"));
  if (attU && defU) {
    return;
  }
  state.phase = BATTLE_PHASE.FINISHED;
  state.winner = !attU && !defU ? "draw" : attU ? "attacker" : "defender";
  state.activeUnitId = null;
  state.log.push(state.winner === "draw" ? "Битва окончена: ничья" : `Битва окончена: победа ${state.winner}`);
};

// single source of truth for ranged/melee target eligibility, shared by the
// attack mutator and the read-only query helpers below
/**
 * @param {ActiveBattle} state
 * @param {ActiveBattleUnit} attacker
 * @param {ActiveBattleUnit} target
 * @param {"arc" | "direct" | "melee"} mode
 * @param {HexMap} map
 * @returns {boolean}
 */
const canRangedHit = (state, attacker, target, mode, map) => {
  if (!target || target.position === null || target.destroyed || target.side === attacker.side) {
    return false;
  }
  const type = unitTypeOf(attacker);
  const ranged = type?.ranged ?? null;
  const aElev = type?.noElevationBonus
    ? 0
    : (terrainAt(map, attacker.position.row, attacker.position.col).elevation ?? 0);

  if (mode === "melee") {
    return zoneOf(target.position, target.facing, attacker.position) !== null;
  }

  if (!ranged) {
    return false;
  }

  if (mode === "arc") {
    if (!ranged.arc || attacker.ammo <= 0 || (attacker.cooldown ?? 0) !== 0) {
      return false;
    }
    if (terrainAt(map, target.position.row, target.position.col).noArcTarget) {
      return false;
    }
    const reach = frontalConeReach(attacker.position, attacker.facing, target.position);
    if (reach === null || reach > ranged.arc.range + aElev) {
      return false;
    }
    return !arcBlocked(attacker.position, target.position, { terrainAt: (r, c) => terrainAt(map, r, c) });
  }

  if (mode === "direct") {
    if (attacker.ammo <= 0 || (attacker.cooldown ?? 0) !== 0) {
      return false;
    }
    const reach = frontalConeReach(attacker.position, attacker.facing, target.position);
    if (reach === null || reach > ranged.direct.range + aElev) {
      return false;
    }
    return !directLosBlocked(attacker.position, target.position, {
      terrainAt: (r, c) => terrainAt(map, r, c),
      unitAt: (r, c) => unitAt(state, r, c),
      shooterElevation: aElev,
    });
  }

  return false;
};

/**
 * Ordered units (target outward) shifted one hex along `pushDir`, or null when
 * the line's landing hex is off-map / impassable (then no push).
 * @param {ActiveBattle} state
 * @param {ActiveBattleUnit} target
 * @param {number} pushDir edge 0..5
 * @param {HexMap} map
 * @returns {ActiveBattleUnit[] | null}
 */
const breakthroughChain = (state, target, pushDir, map) => {
  const chain = [];
  let cur = target;
  while (cur) {
    chain.push(cur);
    const next = neighbor(cur.position, pushDir);
    const inBounds = next.row >= 0 && next.row < map.height && next.col >= 0 && next.col < map.width;
    if (!inBounds || terrainAt(map, next.row, next.col).impassable) {
      return null;
    }
    const occ = unitAt(state, next.row, next.col);
    if (!occ) {
      return chain;
    }
    cur = occ;
  }
  return null;
};

/**
 * Core attack resolution from an EXPLICIT attacker (shared by the player attack
 * mutator and opportunity reactions). Applies damage, reflection, loss cascade,
 * victory; unless isOpportunity, arms a shock-infantry breakthrough.
 * @param {ActiveBattle} state
 * @param {ActiveBattleUnit} attacker
 * @param {ActiveBattleUnit} target
 * @param {HexMap} map
 * @param {"arc" | "direct" | "melee"} [mode]
 * @param {{isOpportunity?: boolean}} [opts]
 */
const performAttack = (state, attacker, target, map, mode, { isOpportunity = false } = {}) => {
  if (!attacker || attacker.position === null || attacker.destroyed || attacker.routed) {
    return;
  }
  if (!target || target.position === null || target.destroyed || target.side === attacker.side) {
    return;
  }
  const type = unitTypeOf(attacker);
  const ranged = type?.ranged ?? null;
  const resolvedMode = ranged ? (mode ?? "melee") : "melee";
  if (!canRangedHit(state, attacker, target, resolvedMode, map)) {
    return;
  }

  const aT = terrainAt(map, attacker.position.row, attacker.position.col);
  const dT = terrainAt(map, target.position.row, target.position.col);
  const aElev = aT.elevation ?? 0;
  const dElev = dT.elevation ?? 0;
  // doc §4: horse archer gets no hill bonuses — high ground never boosts its damage
  const elevMult = type?.noElevationBonus
    ? Math.min(elevationDamageMult(aElev, dElev), 1)
    : elevationDamageMult(aElev, dElev);

  let zone;
  let attackMult;
  let terrainMults;
  let extraMoraleMult;
  let modeLabel;
  let hpMult = 1;
  let moraleCapExempt = false;
  let breakthroughInfo = null;
  let reflectDamage = false;
  if (resolvedMode === "melee") {
    const actualZone = zoneOf(target.position, target.facing, attacker.position);
    const atkGroup = getUnitGroupType(attacker.type);
    const tgtGroup = getUnitGroupType(target.type);
    const isShock = atkGroup === ACTIVE_UNIT_GROUP_TYPE.SHOCK_INFANTRY;
    const tgtIsSpearman = tgtGroup === ACTIVE_UNIT_GROUP_TYPE.SPEARMEN;
    const isCharging = (type?.ramModifier ?? 0) > 0 && attacker.chargeHexes > 0;

    // shock infantry: a rear hit counts as flank (morale downgrade)
    const moraleZone = (isShock && actualZone === HEX_ZONE.REAR) ? HEX_ZONE.FLANK : actualZone;

    // spearman defender: extra physical from rear; formation cover reduces front damage
    let formationCover = 0;
    let formationMult = 1;
    if (tgtIsSpearman && actualZone === HEX_ZONE.FRONT) {
      formationCover = flankCoverCount(state, target, map);
      formationMult = formationCoverMult(formationCover);
    }
    if (tgtIsSpearman && actualZone === HEX_ZONE.REAR) {
      hpMult = 1.5;
    }

    // cavalry charge (ram)
    const chargeMult = isCharging ? chargeDamageMult(type.ramModifier, attacker.chargeHexes) : 1;
    const chargeMoraleMult = (isCharging && attacker.chargeHexes >= 3) ? 1.25 : 1;

    zone = moraleZone;
    attackMult = (ranged ? ranged.meleeMult : 1) * chargeMult;
    terrainMults = elevMult * formationMult;
    extraMoraleMult = (unitTypeOf(target)?.ranged ? 1.5 : 1) * chargeMoraleMult;
    moraleCapExempt = isCharging; // charge morale exempt from ×3 cap (doc §1.7)
    reflectDamage = isCharging && tgtIsSpearman && actualZone === HEX_ZONE.FRONT && formationCover >= 1;
    // breakthrough eligibility decided AFTER damage (needs dealt hpDamage + survival)
    breakthroughInfo = (isShock && actualZone === HEX_ZONE.FRONT) ? { pushDir: directionTo(attacker.position, target.position) } : null;
    modeLabel = "атакует";
  } else if (resolvedMode === "arc") {
    zone = zoneAtRange(target.position, target.facing, attacker.position);
    attackMult = ranged.arc.mult;
    terrainMults = elevMult * (dT.rangedDamageTakenMult ?? 1);
    extraMoraleMult = 1;
    modeLabel = "обстреливает навесом";
  } else {
    zone = zoneAtRange(target.position, target.facing, attacker.position);
    attackMult = ranged.direct.mult;
    terrainMults = elevMult * (dT.rangedDamageTakenMult ?? 1);
    extraMoraleMult = 1;
    modeLabel = "стреляет по";
  }

  const { hpDamage, moraleDamage } = resolveAttack({
    attacker,
    defender: target,
    zone,
    terrainMults,
    attackMult,
    extraMoraleMult,
    hpMult,
    moraleCapExempt,
  });
  target.hp -= hpDamage;
  target.morale -= moraleDamage;
  attacker.hasAttacked = true;
  attacker.attackedRound = state.round;
  if (resolvedMode === "arc" || resolvedMode === "direct") {
    attacker.ammo -= 1;
    if (ranged.cooldown) {
      attacker.cooldown = ranged.cooldown;
    }
  }
  state.log.push(`${attacker.name} ${modeLabel} ${target.name}: -${hpDamage} ❤️, -${moraleDamage} 📯`);

  // charge reflection (doc «Сомкнутый строй»): spearman reflects the charge hit,
  // not counted as an attack
  if (reflectDamage) {
    attacker.hp -= hpDamage;
    state.log.push(`${target.name} отражает урон разбега: -${hpDamage} ❤️`);
  }
  applyLossCascade(state, target);
  if (reflectDamage) {
    applyLossCascade(state, attacker);
  }
  checkVictory(state);

  if (
    !isOpportunity &&
    breakthroughInfo &&
    state.phase === BATTLE_PHASE.ACTIVE &&
    !target.destroyed && !target.routed && target.position !== null &&
    hpDamage >= target.attack &&
    breakthroughChain(state, target, breakthroughInfo.pushDir, map) !== null
  ) {
    state.pendingBreakthrough = { attackerId: attacker.id, targetId: target.id, pushDir: breakthroughInfo.pushDir };
  }
};

/**
 * The opportuner's best legal attack mode against the mover, or null.
 * @param {ActiveBattle} state
 * @param {ActiveBattleUnit} opp
 * @param {ActiveBattleUnit} mover
 * @param {HexMap} map
 * @returns {"arc" | "direct" | "melee" | null}
 */
const bestOpportunityMode = (state, opp, mover, map) => {
  const type = unitTypeOf(opp);
  if (type?.ranged) {
    return ["direct", "arc", "melee"].find((m) => canRangedHit(state, opp, mover, m, map)) ?? null;
  }
  return canRangedHit(state, opp, mover, "melee", map) ? "melee" : null;
};

/**
 * Resolve one opportuner's reaction against the mover.
 * @param {ActiveBattle} state
 * @param {number} oppId
 * @param {ActiveBattleUnit} mover
 * @param {HexMap} map
 */
const reactOpportunity = (state, oppId, mover, map) => {
  const opp = findUnit(state, oppId);
  if (!opp || opp.destroyed || opp.routed || opp.position === null) {
    return;
  }
  if (opp.attackedRound === state.round) {
    return; // already acted/reacted this round
  }
  if (!mover || mover.destroyed || mover.routed || mover.position === null) {
    return;
  }
  const mode = bestOpportunityMode(state, opp, mover, map);
  if (!mode) {
    return;
  }
  state.log.push(`${opp.name} наносит оппортун по ${mover.name}`);
  performAttack(state, opp, mover, map, mode, { isOpportunity: true });
  opp.attackedRound = state.round;
  opp.reactedRound = state.round;
};

/**
 * Resolve the full pending opportunity queue (used by advance/rotate/accelerate).
 * @param {ActiveBattle} state
 * @param {HexMap} map
 */
const resolveAllReactions = (state, map) => {
  const pending = state.pendingOpportunity;
  if (!pending) {
    return;
  }
  state.pendingOpportunity = null;
  const mover = findUnit(state, pending.targetId);
  for (const id of pending.queue) {
    reactOpportunity(state, id, mover, map);
  }
};

/**
 * True if `opp` could legally attack a unit at `target`'s current position in any mode.
 * @param {ActiveBattle} state
 * @param {ActiveBattleUnit} opp
 * @param {ActiveBattleUnit} target
 * @param {HexMap} map
 * @returns {boolean}
 */
const hasAnyAttackMode = (state, opp, target, map) =>
  canRangedHit(state, opp, target, "melee", map) ||
  canRangedHit(state, opp, target, "direct", map) ||
  canRangedHit(state, opp, target, "arc", map);

/**
 * Arm reactions for every enemy the mover NEWLY entered the attack zone of.
 * @param {ActiveBattle} state
 * @param {ActiveBattleUnit} mover
 * @param {{row: number, col: number}} fromPos
 * @param {HexMap} map
 */
const armOpportunities = (state, mover, fromPos, map) => {
  const eligible = [];
  for (const opp of state.units) {
    if (opp.side === mover.side || opp.id === mover.id) {
      continue;
    }
    if (opp.destroyed || opp.routed || opp.position === null) {
      continue;
    }
    if (opp.attackedRound === state.round) {
      continue;
    }
    if (!hasAnyAttackMode(state, opp, mover, map)) {
      continue; // in zone now (mover at toPos)
    }
    const saved = mover.position;
    mover.position = fromPos;
    const wasIn = hasAnyAttackMode(state, opp, mover, map); // in zone before the move?
    mover.position = saved;
    if (wasIn) {
      continue; // not newly entered
    }
    eligible.push(opp.id);
  }
  if (eligible.length === 0) {
    return;
  }
  eligible.sort((a, b) => a - b);
  if (state.pendingOpportunity && state.pendingOpportunity.targetId === mover.id) {
    for (const id of eligible) {
      if (!state.pendingOpportunity.queue.includes(id)) {
        state.pendingOpportunity.queue.push(id);
      }
    }
  } else {
    state.pendingOpportunity = { queue: eligible, targetId: mover.id };
  }
};

/**
 * @param {ActiveBattle} state
 * @param {number} targetId
 * @param {HexMap} map
 * @param {"arc" | "direct" | "melee"} [mode]
 */
const attack = (state, targetId, map, mode) => {
  const attacker = findUnit(state, state.activeUnitId);
  const pending = state.pendingOpportunity;
  if (pending && attacker && pending.targetId === attacker.id) {
    state.pendingOpportunity = null;
    const strikeFirst = pending.queue.includes(targetId);
    // non-target opportuners strike before the mover's declared attack
    for (const id of pending.queue) {
      if (strikeFirst && id === targetId) {
        continue;
      }
      reactOpportunity(state, id, attacker, map);
    }
    // strike-first: the mover attacks the opportuner it declared, first
    if (
      !attacker.hasAttacked && !attacker.routed && attacker.position !== null &&
      attacker.reactedRound !== state.round
    ) {
      performAttack(state, attacker, findUnit(state, targetId), map, mode);
    }
    if (strikeFirst) {
      reactOpportunity(state, targetId, attacker, map); // reacts only if it survived
    }
    return;
  }
  if (
    !attacker || attacker.routed || attacker.position === null ||
    attacker.hasAttacked || attacker.reactedRound === state.round
  ) {
    return;
  }
  performAttack(state, attacker, findUnit(state, targetId), map, mode);
};

/**
 * @param {ActiveBattle} state
 * @param {HexMap} map
 */
const applyBreakthrough = (state, map) => {
  const pb = state.pendingBreakthrough;
  state.pendingBreakthrough = null;
  if (!pb) {
    return;
  }
  const attacker = findUnit(state, pb.attackerId);
  const target = findUnit(state, pb.targetId);
  if (!attacker || !target || attacker.position === null || target.position === null) {
    return;
  }
  const chain = breakthroughChain(state, target, pb.pushDir, map);
  if (!chain) {
    return;
  }
  const targetHex = { row: target.position.row, col: target.position.col };
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    chain[i].position = neighbor(chain[i].position, pb.pushDir);
  }
  attacker.position = targetHex;
  state.log.push(`${attacker.name} прорывается`);
};

/**
 * @param {ActiveBattle} state
 */
const declineBreakthrough = (state) => {
  state.pendingBreakthrough = null;
};

/**
 * @param {ActiveBattle} state
 * @param {HexMap} map
 * @param {"arc" | "direct" | "melee"} mode
 * @returns {number[]} target ids the active unit can hit in `mode` right now
 */
const validRangedTargets = (state, map, mode) => {
  const a = findUnit(state, state.activeUnitId);
  if (!a || a.position === null || a.routed || a.hasAttacked) {
    return [];
  }
  return state.units.filter((t) => canRangedHit(state, a, t, mode, map)).map((t) => t.id);
};

/**
 * @param {ActiveBattle} state
 * @param {HexMap} map
 * @returns {{arc: boolean, direct: boolean, melee: boolean}} which fire modes have at least one legal target this activation
 */
const fireModesAvailable = (state, map) => ({
  arc: validRangedTargets(state, map, "arc").length > 0,
  direct: validRangedTargets(state, map, "direct").length > 0,
  melee: validRangedTargets(state, map, "melee").length > 0,
});

/**
 * @param {ActiveBattle} state
 * @param {BattleConfigSide} side
 */
const capitulate = (state, side) => {
  if (state.phase !== BATTLE_PHASE.ACTIVE) {
    return;
  }
  if (side !== "attacker" && side !== "defender") {
    return;
  }
  state.phase = BATTLE_PHASE.FINISHED;
  state.winner = side === "attacker" ? "defender" : "attacker";
  state.activeUnitId = null;
  state.log.push(`${side} капитулирует`);
};

/**
 * Auto-flees the active (routed) unit toward its deployment edge using its
 * normal MP, then ends its activation.
 * @param {ActiveBattle} state
 * @param {HexMap} map
 */
const routTick = (state, map) => {
  const u = findUnit(state, state.activeUnitId);
  if (!u || !u.routed || u.position === null) {
    endActivation(state, map);
    return;
  }
  const edgeRow = u.side === "attacker" ? 0 : map.height - 1;
  if (u.position.row === edgeRow) {
    u.position = null;
    state.log.push(`${u.name} покидает поле`);
    endActivation(state, map);
    checkVictory(state);
    return;
  }
  const isGoal = (row) => row === edgeRow;
  const isPassable = (row, col) => (
    row >= 0 && row < map.height && col >= 0 && col < map.width &&
    !terrainAt(map, row, col).impassable &&
    (unitAt(state, row, col) === null || unitAt(state, row, col) === u)
  );
  const path = fleePath(u.position, (r) => isGoal(r), (r, c) => isPassable(r, c));
  for (const step of path) {
    const fromT = terrainAt(map, u.position.row, u.position.col);
    const toT = terrainAt(map, step.row, step.col);
    const cost = advanceCost(fromT, toT, unitTypeOf(u));
    if (u.movePoints < cost) {
      break;
    }
    u.movePoints -= cost;
    u.position = { row: step.row, col: step.col };
    if (step.row === edgeRow) {
      u.position = null;
      break;
    }
  }
  state.log.push(`${u.name} бежит`);
  endActivation(state, map);
  checkVictory(state);
};

export {
  BATTLE_PHASE,
  DEFAULT_FACING_BY_SIDE,
  createActiveBattle,
  startBattleDisposition,
  startBattle,
  findUnit,
  unitAt,
  resetActiveBattle,
  advanceUnit,
  rotateUnit,
  accelerate,
  endActivation,
  attack,
  validRangedTargets,
  fireModesAvailable,
  capitulate,
  routTick,
  checkVictory,
  applyBreakthrough,
  declineBreakthrough,
  rulerAuraBonus,
  effectiveMorale,
};
