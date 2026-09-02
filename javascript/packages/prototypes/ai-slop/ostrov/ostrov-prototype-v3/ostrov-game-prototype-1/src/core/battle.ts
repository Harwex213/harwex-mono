import { MAX_SQUADS_PER_SIDE, PASSIVE_DEFENCE_ARMOR, SQUAD_DEFS } from "./catalog";
import { buildingOn, buildingsOf, factionById, isBuilt, log, removeUnit } from "./entities";
import { HITECH_FACTION_ID, PLAYERS_FACTION_ID } from "./factions";
import { isKnown } from "./tech";
import { captureTile } from "./rules";
import type { TRng } from "@hw/ostrov-utils";
import type { TBattleSetup, TGame, TPlayerId, TSquadType } from "./state";

/** Rounds after which the assault is called off and the defender holds the hex. */
const ROUND_LIMIT = 30;

/** Share of the hit that each other squad in a splashed row takes. */
const SPLASH_SHARE = 0.6;

/** Each point of armour shaves this share off a hit, up to `ARMOR_CAP`. */
const ARMOR_STEP = 0.1;
const ARMOR_CAP = 0.6;

type TSkillId = "volley" | "rally" | "shield" | "overcharge";

type TSkill = {
  id: TSkillId;
  name: string;
  summary: string;
  used: boolean;
};

type TBattleSquad = {
  id: string;
  unitId: string;
  type: TSquadType;
  name: string;
  hp: number;
  hpMax: number;
  slot: number;
};

type TBattleSide = {
  role: "attacker" | "defender";
  factionId: string;
  factionName: string;
  color: string;
  /** Set for the players' side: the seat that moved, or the first seat that owns a defender. */
  player: TPlayerId | null;
  squads: TBattleSquad[];
  armorBonus: number;
  skills: TSkill[];
  /** A skill chosen for the coming round. */
  queuedSkill: TSkillId | null;
};

type TBattleEvent = {
  id: number;
  round: number;
  text: string;
  tone: "attacker" | "defender" | "system";
};

type TBattle = {
  setup: TBattleSetup;
  attacker: TBattleSide;
  defender: TBattleSide;
  round: number;
  phase: "deploy" | "fighting" | "done";
  events: TBattleEvent[];
  winner: "attacker" | "defender" | null;
  nextEventId: number;
};

const SKILL_DEFS: Record<TSkillId, Omit<TSkill, "used">> = {
  volley: { id: "volley", name: "Залп", summary: "Казармы: 6 урона каждому вражескому отряду" },
  rally: { id: "rally", name: "Боевой дух", summary: "Военное дело: ваши отряды бьют в полтора раза сильнее в этом раунде" },
  shield: { id: "shield", name: "Энергощит", summary: "Электричество: +4 брони вашим отрядам в этом раунде" },
  overcharge: { id: "overcharge", name: "Перегрузка ядра", summary: "Нексус: отряды бьют в полтора раза сильнее" },
};

const skillsFor = (game: TGame, factionId: string): TSkill[] => {
  const skills: TSkill[] = [];

  if (factionId === PLAYERS_FACTION_ID) {
    if (buildingsOf(game, factionId).some((building) => building.type === "barracks" && isBuilt(building))) {
      skills.push({ ...SKILL_DEFS.volley, used: false });
    }

    if (isKnown(game.research, "warfare")) {
      skills.push({ ...SKILL_DEFS.rally, used: false });
    }

    if (isKnown(game.research, "electricity")) {
      skills.push({ ...SKILL_DEFS.shield, used: false });
    }
  }

  if (factionId === HITECH_FACTION_ID) {
    skills.push({ ...SKILL_DEFS.overcharge, used: false });
  }

  return skills;
};

/** Front row first, then the back row, in the order the squads were listed. */
const autoDeploy = (squads: TBattleSquad[]) => {
  squads.forEach((squad, index) => {
    squad.slot = index;
  });
};

const gatherSquads = (game: TGame, unitIds: readonly string[]): TBattleSquad[] => {
  const squads: TBattleSquad[] = [];

  for (const unitId of unitIds) {
    const unit = game.units[unitId];

    if (unit === undefined) {
      continue;
    }

    for (const squad of unit.squads) {
      if (squads.length >= MAX_SQUADS_PER_SIDE) {
        break;
      }

      squads.push({
        id: squad.id,
        unitId,
        type: squad.type,
        name: SQUAD_DEFS[squad.type].name,
        hp: squad.hp,
        hpMax: squad.hpMax,
        slot: squads.length,
      });
    }
  }

  return squads;
};

const playerOf = (game: TGame, unitIds: readonly string[], fallback: TPlayerId | null) => {
  if (fallback !== null) {
    return fallback;
  }

  for (const unitId of unitIds) {
    const owner = game.units[unitId]?.owner;

    if (owner !== undefined && owner !== null) {
      return owner;
    }
  }

  return null;
};

const createBattle = (game: TGame, setup: TBattleSetup): TBattle => {
  const attackerFaction = factionById(game, setup.attackerFactionId);
  const defenderFaction = factionById(game, setup.defenderFactionId);
  const building = buildingOn(game, setup.tileId);
  const fortified =
    building !== null &&
    building.factionId === setup.defenderFactionId &&
    isBuilt(building) &&
    (building.type === "barracks" || building.type === "camp" || building.type === "core");

  const attackerSquads = gatherSquads(game, setup.attackerUnitIds);
  const defenderSquads = gatherSquads(game, setup.defenderUnitIds);
  autoDeploy(attackerSquads);
  autoDeploy(defenderSquads);

  const battle: TBattle = {
    setup,
    attacker: {
      role: "attacker",
      factionId: attackerFaction.id,
      factionName: attackerFaction.name,
      color: attackerFaction.color,
      player: playerOf(game, setup.attackerUnitIds, setup.attackerPlayer),
      squads: attackerSquads,
      armorBonus: 0,
      skills: skillsFor(game, attackerFaction.id),
      queuedSkill: null,
    },
    defender: {
      role: "defender",
      factionId: defenderFaction.id,
      factionName: defenderFaction.name,
      color: defenderFaction.color,
      player: playerOf(game, setup.defenderUnitIds, null),
      squads: defenderSquads,
      armorBonus: fortified ? PASSIVE_DEFENCE_ARMOR : 0,
      skills: skillsFor(game, defenderFaction.id),
      queuedSkill: null,
    },
    round: 0,
    phase: "deploy",
    events: [],
    winner: null,
    nextEventId: 1,
  };

  pushEvent(battle, `Атакуют: ${attackerFaction.name}. Обороняются: ${defenderFaction.name}${fortified ? " под защитой укрепления (+3 брони)" : ""}.`, "system");

  return battle;
};

const pushEvent = (battle: TBattle, text: string, tone: TBattleEvent["tone"]) => {
  battle.events.push({ id: battle.nextEventId, round: battle.round, text, tone });
  battle.nextEventId += 1;
};

/** Puts a squad into a slot. A squad already there swaps places with it. */
const setSquadSlot = (battle: TBattle, role: "attacker" | "defender", squadId: string, slot: number) => {
  if (battle.phase !== "deploy") {
    return;
  }

  const side = battle[role];
  const squad = side.squads.find((found) => found.id === squadId);

  if (squad === undefined) {
    return;
  }

  const occupant = side.squads.find((found) => found.slot === slot);
  if (occupant !== undefined) {
    occupant.slot = squad.slot;
  }

  squad.slot = slot;
};

const queueSkill = (battle: TBattle, role: "attacker" | "defender", skillId: TSkillId) => {
  const side = battle[role];
  const skill = side.skills.find((found) => found.id === skillId);

  if (skill === undefined || skill.used || battle.phase === "done") {
    return;
  }

  side.queuedSkill = skillId;
};

const alive = (side: TBattleSide) => side.squads.filter((squad) => squad.hp > 0);

const isFront = (squad: TBattleSquad) => squad.slot < 3;

const pickTarget = (actor: TBattleSquad, enemies: TBattleSquad[], rng: TRng): TBattleSquad | null => {
  if (enemies.length === 0) {
    return null;
  }

  const def = SQUAD_DEFS[actor.type];

  if (def.range >= 2) {
    return [...enemies].sort((a, b) => a.hp - b.hp)[0]!;
  }

  const front = enemies.filter(isFront);
  const pool = front.length > 0 ? front : enemies;

  return pool[rng.int(0, pool.length - 1)]!;
};

type TRoundMods = {
  attackMul: number;
  armorAdd: number;
};

const applyQueuedSkill = (battle: TBattle, side: TBattleSide, enemy: TBattleSide): TRoundMods => {
  const mods: TRoundMods = { attackMul: 1, armorAdd: 0 };

  if (side.queuedSkill === null) {
    return mods;
  }

  const skill = side.skills.find((found) => found.id === side.queuedSkill);
  side.queuedSkill = null;

  if (skill === undefined || skill.used) {
    return mods;
  }

  skill.used = true;

  switch (skill.id) {
    case "volley": {
      for (const target of alive(enemy)) {
        target.hp = Math.max(0, target.hp - 6);
      }
      pushEvent(battle, `${side.factionName}: «Залп» — 6 урона каждому отряду противника.`, side.role);
      break;
    }
    case "rally":
    case "overcharge": {
      mods.attackMul = 1.5;
      pushEvent(battle, `${side.factionName}: «${skill.name}» — удары в полтора раза сильнее.`, side.role);
      break;
    }
    case "shield": {
      mods.armorAdd = 4;
      pushEvent(battle, `${side.factionName}: «Энергощит» — +4 брони в этом раунде.`, side.role);
      break;
    }
  }

  return mods;
};

const settle = (battle: TBattle) => {
  const attackersLeft = alive(battle.attacker).length;
  const defendersLeft = alive(battle.defender).length;

  if (attackersLeft > 0 && defendersLeft > 0 && battle.round < ROUND_LIMIT) {
    return;
  }

  battle.phase = "done";

  if (defendersLeft === 0 && attackersLeft > 0) {
    battle.winner = "attacker";
    pushEvent(battle, `Победа атакующих (${battle.attacker.factionName}). Гекс взят.`, "system");

    return;
  }

  battle.winner = "defender";
  pushEvent(battle, attackersLeft === 0 ? `Победа обороняющихся (${battle.defender.factionName}). Атака отбита.` : "Штурм захлебнулся. Обороняющиеся удержали гекс.", "system");
};

/** Plays one round: skills fire, then every living squad strikes in speed order. */
const runRound = (battle: TBattle, rng: TRng) => {
  if (battle.phase === "done") {
    return;
  }

  battle.phase = "fighting";
  battle.round += 1;
  pushEvent(battle, `— Раунд ${battle.round} —`, "system");

  // The Nexus fires its skill on the second round without being asked.
  if (battle.round === 2) {
    for (const side of [battle.attacker, battle.defender]) {
      const overcharge = side.skills.find((skill) => skill.id === "overcharge" && !skill.used);

      if (overcharge !== undefined && side.player === null) {
        side.queuedSkill = "overcharge";
      }
    }
  }

  const mods = {
    attacker: applyQueuedSkill(battle, battle.attacker, battle.defender),
    defender: applyQueuedSkill(battle, battle.defender, battle.attacker),
  };

  const order = [
    ...alive(battle.attacker).map((squad) => ({ squad, side: battle.attacker, enemy: battle.defender })),
    ...alive(battle.defender).map((squad) => ({ squad, side: battle.defender, enemy: battle.attacker })),
  ].sort((a, b) => {
    const speed = SQUAD_DEFS[b.squad.type].speed - SQUAD_DEFS[a.squad.type].speed;

    if (speed !== 0) {
      return speed;
    }

    return a.side.role === "attacker" ? -1 : 1;
  });

  for (const { squad, side, enemy } of order) {
    if (squad.hp <= 0) {
      continue;
    }

    const enemies = alive(enemy);
    const target = pickTarget(squad, enemies, rng);

    if (target === null) {
      break;
    }

    const def = SQUAD_DEFS[squad.type];
    const sideMods = mods[side.role];
    const enemyMods = mods[enemy.role];
    const hit = (victim: TBattleSquad, share: number) => {
      const armor = SQUAD_DEFS[victim.type].armor + enemy.armorBonus + enemyMods.armorAdd;
      const raw = def.attack * rng.range(0.85, 1.15) * sideMods.attackMul * share;
      const damage = Math.max(1, Math.round(raw * (1 - Math.min(ARMOR_CAP, armor * ARMOR_STEP))));
      victim.hp = Math.max(0, victim.hp - damage);

      return damage;
    };

    const damage = hit(target, 1);
    const killed = target.hp <= 0 ? " — отряд уничтожен" : "";
    pushEvent(battle, `${squad.name} бьёт ${target.name}: −${damage}${killed}.`, side.role);

    if (def.splash) {
      const row = enemies.filter((other) => other.id !== target.id && isFront(other) === isFront(target) && other.hp > 0);

      for (const other of row) {
        const splash = hit(other, SPLASH_SHARE);
        pushEvent(battle, `  осколки задевают ${other.name}: −${splash}${other.hp <= 0 ? " — отряд уничтожен" : ""}.`, side.role);
      }
    }
  }

  settle(battle);
};

/** Writes the outcome back into the world: squad health, lost units, the hex itself. */
const finishBattle = (game: TGame, battle: TBattle) => {
  const bySquad = new Map<string, TBattleSquad>();
  for (const squad of [...battle.attacker.squads, ...battle.defender.squads]) {
    bySquad.set(squad.id, squad);
  }

  for (const unitId of [...battle.setup.attackerUnitIds, ...battle.setup.defenderUnitIds]) {
    const unit = game.units[unitId];

    if (unit === undefined) {
      continue;
    }

    unit.squads = unit.squads.filter((squad) => {
      const fought = bySquad.get(squad.id);

      if (fought === undefined) {
        return true;
      }

      squad.hp = fought.hp;

      return fought.hp > 0;
    });

    if (unit.squads.length === 0) {
      removeUnit(game, unit.id);
    }
  }

  const tile = game.tiles[battle.setup.tileId]!;
  const attackerName = battle.attacker.factionName;
  const defenderName = battle.defender.factionName;

  if (battle.winner === "attacker") {
    log(game, `Бой за гекс: победа — ${attackerName}. Гекс взят у ${defenderName === attackerName ? "противника" : "обороняющихся"}.`, battle.attacker.factionId === PLAYERS_FACTION_ID ? "good" : "bad");
    captureTile(game, tile.id, battle.attacker.factionId, battle.attacker.player);

    return;
  }

  // The attackers who survive fall back to where they came from is not modelled:
  // a beaten attacker on the hex is lost, a repelled one keeps its squads.
  for (const unitId of battle.setup.attackerUnitIds) {
    const unit = game.units[unitId];

    if (unit !== undefined) {
      removeUnit(game, unit.id);
      log(game, `Уцелевшие атакующие (${attackerName}) рассеяны.`, battle.attacker.factionId === PLAYERS_FACTION_ID ? "bad" : "good");
    }
  }

  log(game, `Бой за гекс: победа — ${defenderName}. Атака (${attackerName}) отбита.`, battle.defender.factionId === PLAYERS_FACTION_ID ? "good" : "bad");
};

export type { TBattle, TBattleEvent, TBattleSide, TBattleSquad, TSkill, TSkillId };
export { SKILL_DEFS, createBattle, finishBattle, queueSkill, runRound, setSquadSlot };
