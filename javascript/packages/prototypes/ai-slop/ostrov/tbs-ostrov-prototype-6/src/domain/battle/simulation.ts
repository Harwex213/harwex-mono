import { archetypeOf } from "./archetypes";
import { clampToArena } from "../arena/arena";
import type { TArchetype } from "./archetypes";
import type { TFighter, TRosterUnit, TSimulation, TTeam } from "./types";

/** The battle always advances in fixed steps, whatever the frame rate is. */
const BATTLE_STEP = 1 / 60;

/** A stalled battle is called on remaining health after this many seconds. */
const BATTLE_TIME_LIMIT = 75;

const teamWord = (team: TTeam): string => (team === "player" ? "Наш" : "Вражеский");

const createSimulation = (units: readonly TRosterUnit[]): TSimulation => {
  const fighters = units.map((unit) => {
    const archetype = archetypeOf(unit.archetypeId);

    return {
      id: unit.id,
      team: unit.team,
      archetypeId: unit.archetypeId,
      x: unit.x,
      y: unit.y,
      vx: 0,
      vy: 0,
      hp: archetype.maxHp,
      maxHp: archetype.maxHp,
      cooldown: 0.2 + 0.2 * Math.random(),
      retargetIn: 0,
      targetId: null,
      swing: 0,
      facing: unit.team === "player" ? -Math.PI / 2 : Math.PI / 2,
      hitFlash: 0,
      healFlash: 0,
      dead: false,
      deathAge: 0,
    } satisfies TFighter;
  });

  return {
    fighters,
    projectiles: [],
    floaters: [],
    events: [],
    time: 0,
    carry: 0,
    outcome: "running",
    nextId: 1,
  };
};

const fighterById = (sim: TSimulation, id: string | null): TFighter | null => {
  if (id === null) {
    return null;
  }

  return sim.fighters.find((fighter) => fighter.id === id) ?? null;
};

const aliveCount = (sim: TSimulation, team: TTeam): number => {
  return sim.fighters.filter((fighter) => fighter.team === team && !fighter.dead).length;
};

const teamHealth = (sim: TSimulation, team: TTeam): number => {
  return sim.fighters.reduce((total, fighter) => {
    if (fighter.team !== team || fighter.dead) {
      return total;
    }

    return total + fighter.hp;
  }, 0);
};

const nearestEnemy = (sim: TSimulation, self: TFighter): TFighter | null => {
  let best: TFighter | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const other of sim.fighters) {
    if (other.dead || other.team === self.team) {
      continue;
    }

    const distance = Math.hypot(other.x - self.x, other.y - self.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = other;
    }
  }

  return best;
};

/** The ally with the lowest health share inside `range`, if any is hurt. */
const mostWoundedAlly = (sim: TSimulation, self: TFighter, range: number): TFighter | null => {
  let best: TFighter | null = null;
  let bestShare = 0.999;

  for (const other of sim.fighters) {
    if (other.dead || other.team !== self.team) {
      continue;
    }

    if (Math.hypot(other.x - self.x, other.y - self.y) > range) {
      continue;
    }

    const share = other.hp / other.maxHp;
    if (share < bestShare) {
      bestShare = share;
      best = other;
    }
  }

  return best;
};

const pushFloater = (sim: TSimulation, x: number, y: number, text: string, tone: "damage" | "heal"): void => {
  sim.nextId += 1;
  sim.floaters.push({
    id: `f${sim.nextId}`,
    x,
    y,
    text,
    tone,
    age: 0,
    life: 0.85,
  });
};

const dealDamage = (sim: TSimulation, victim: TFighter, amount: number): void => {
  const archetype = archetypeOf(victim.archetypeId);
  const dealt = Math.max(1, Math.round(amount - archetype.armor));

  victim.hp -= dealt;
  victim.hitFlash = 1;
  pushFloater(sim, victim.x, victim.y - archetype.radius - 8, `-${dealt}`, "damage");

  if (victim.hp > 0) {
    return;
  }

  victim.hp = 0;
  victim.dead = true;
  victim.deathAge = 0;
  victim.targetId = null;
  sim.events.push(`${teamWord(victim.team)} ${archetype.name} пал`);
};

const healFighter = (sim: TSimulation, target: TFighter, amount: number): void => {
  const healed = Math.min(amount, target.maxHp - target.hp);
  if (healed <= 0) {
    return;
  }

  target.hp += healed;
  target.healFlash = 1;
  pushFloater(sim, target.x, target.y - archetypeOf(target.archetypeId).radius - 8, `+${Math.round(healed)}`, "heal");
};

const spawnProjectile = (
  sim: TSimulation,
  source: TFighter,
  target: TFighter,
  kind: "arrow" | "mote",
  damage: number,
  heal: number
): void => {
  sim.nextId += 1;
  sim.projectiles.push({
    id: `p${sim.nextId}`,
    kind,
    team: source.team,
    x: source.x,
    y: source.y,
    angle: Math.atan2(target.y - source.y, target.x - source.x),
    speed: kind === "arrow" ? 460 : 320,
    damage,
    heal,
    targetId: target.id,
  });
};

/** Bodies never overlap: everyone pushes everyone else out of their radius. */
const separation = (sim: TSimulation, self: TFighter, archetype: TArchetype): { x: number; y: number } => {
  let x = 0;
  let y = 0;

  for (const other of sim.fighters) {
    if (other === self || other.dead) {
      continue;
    }

    const minDistance = archetype.radius + archetypeOf(other.archetypeId).radius + 3;
    const dx = self.x - other.x;
    const dy = self.y - other.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq >= minDistance * minDistance) {
      continue;
    }

    const distance = Math.max(0.001, Math.sqrt(distanceSq));
    const push = ((minDistance - distance) / minDistance) * 1.7;
    x += (dx / distance) * push;
    y += (dy / distance) * push;
  }

  return { x, y };
};

const updateFighter = (sim: TSimulation, self: TFighter, dt: number): void => {
  if (self.dead) {
    self.deathAge += dt;

    return;
  }

  const archetype = archetypeOf(self.archetypeId);
  self.swing = Math.max(0, self.swing - dt * 3.5);
  self.hitFlash = Math.max(0, self.hitFlash - dt * 3);
  self.healFlash = Math.max(0, self.healFlash - dt * 2);
  self.cooldown -= dt;
  self.retargetIn -= dt;

  let target = fighterById(sim, self.targetId);
  if (!target || target.dead || self.retargetIn <= 0) {
    target = nearestEnemy(sim, self);
    self.targetId = target === null ? null : target.id;
    self.retargetIn = 0.45;
  }

  let steerX = 0;
  let steerY = 0;
  let distance = Number.POSITIVE_INFINITY;

  if (target) {
    const dx = target.x - self.x;
    const dy = target.y - self.y;
    distance = Math.max(0.001, Math.hypot(dx, dy));
    self.facing = Math.atan2(dy, dx);

    if (distance > archetype.range * 0.88) {
      steerX = dx / distance;
      steerY = dy / distance;
    } else if (archetype.ranged && distance < archetype.range * 0.42) {
      steerX = -dx / distance;
      steerY = -dy / distance;
    }
  }

  const push = separation(sim, self, archetype);
  steerX += push.x;
  steerY += push.y;

  const steerLength = Math.hypot(steerX, steerY);
  if (steerLength > 1) {
    steerX /= steerLength;
    steerY /= steerLength;
  }

  const blend = Math.min(1, dt * 10);
  self.vx += (steerX * archetype.speed - self.vx) * blend;
  self.vy += (steerY * archetype.speed - self.vy) * blend;
  self.x += self.vx * dt;
  self.y += self.vy * dt;

  const clamped = clampToArena(self.x, self.y, archetype.radius);
  self.x = clamped.x;
  self.y = clamped.y;

  if (self.cooldown > 0) {
    return;
  }

  if (archetype.heal > 0) {
    const ally = mostWoundedAlly(sim, self, archetype.supportRange);
    if (ally) {
      spawnProjectile(sim, self, ally, "mote", 0, archetype.heal);
      self.cooldown = archetype.attackInterval;
      self.swing = 1;

      return;
    }
  }

  if (!target || distance > archetype.range) {
    return;
  }

  self.cooldown = archetype.attackInterval;
  self.swing = 1;

  if (archetype.ranged) {
    spawnProjectile(sim, self, target, "arrow", archetype.damage, 0);

    return;
  }

  dealDamage(sim, target, archetype.damage);
};

const updateProjectiles = (sim: TSimulation, dt: number): void => {
  const kept = [];

  for (const projectile of sim.projectiles) {
    const target = fighterById(sim, projectile.targetId);
    if (!target || target.dead) {
      continue;
    }

    const dx = target.x - projectile.x;
    const dy = target.y - projectile.y;
    const distance = Math.max(0.001, Math.hypot(dx, dy));
    const step = projectile.speed * dt;
    projectile.angle = Math.atan2(dy, dx);

    if (distance <= step + 4) {
      if (projectile.heal > 0) {
        healFighter(sim, target, projectile.heal);
      } else {
        dealDamage(sim, target, projectile.damage);
      }

      continue;
    }

    projectile.x += (dx / distance) * step;
    projectile.y += (dy / distance) * step;
    kept.push(projectile);
  }

  sim.projectiles = kept;
};

const updateFloaters = (sim: TSimulation, dt: number): void => {
  const kept = [];

  for (const floater of sim.floaters) {
    floater.age += dt;
    floater.y -= dt * 26;

    if (floater.age < floater.life) {
      kept.push(floater);
    }
  }

  sim.floaters = kept;
};

const resolveOutcome = (sim: TSimulation): void => {
  if (sim.outcome !== "running") {
    return;
  }

  const player = aliveCount(sim, "player");
  const enemy = aliveCount(sim, "enemy");

  if (player === 0 && enemy === 0) {
    sim.outcome = "draw";

    return;
  }

  if (player === 0) {
    sim.outcome = "enemy";

    return;
  }

  if (enemy === 0) {
    sim.outcome = "player";

    return;
  }

  if (sim.time < BATTLE_TIME_LIMIT) {
    return;
  }

  const playerHealth = teamHealth(sim, "player");
  const enemyHealth = teamHealth(sim, "enemy");
  sim.events.push("Время боя вышло — считаем уцелевших");

  if (playerHealth > enemyHealth * 1.05) {
    sim.outcome = "player";

    return;
  }

  if (enemyHealth > playerHealth * 1.05) {
    sim.outcome = "enemy";

    return;
  }

  sim.outcome = "draw";
};

const stepSimulation = (sim: TSimulation, dt: number): void => {
  sim.time += dt;

  for (const fighter of sim.fighters) {
    updateFighter(sim, fighter, dt);
  }

  updateProjectiles(sim, dt);
  updateFloaters(sim, dt);
  resolveOutcome(sim);
};

export { BATTLE_STEP, BATTLE_TIME_LIMIT, aliveCount, createSimulation, stepSimulation, teamHealth };
