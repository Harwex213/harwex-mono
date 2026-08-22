import type { ProjectileKind, TargetRef, Team, Weapon } from "../types";
import type { World } from "../world";
import { addEffect, targetPosition } from "../world";
import { dealDamage, dealSplash } from "./damage";

function spawnProjectile(
  world: World,
  x: number,
  y: number,
  target: TargetRef,
  weapon: Weapon,
  damage: number,
  team: Team,
): void {
  const pos = targetPosition(world, target);
  if (!pos) {
    return;
  }
  world.projectiles.push({
    x,
    y,
    fromX: x,
    fromY: y,
    tx: pos.x,
    ty: pos.y,
    speed: weapon.projectileSpeed ?? 360,
    damage,
    splash: weapon.splash ?? 0,
    team,
    kind: weapon.projectile ?? "arrow",
    target,
    dead: false,
  });
}

function updateProjectiles(world: World, dt: number): void {
  for (const shot of world.projectiles) {
    if (shot.dead) {
      continue;
    }
    if (shot.target) {
      const pos = targetPosition(world, shot.target);
      if (pos) {
        shot.tx = pos.x;
        shot.ty = pos.y;
      } else {
        // The target died in flight; the shot still lands where it was aimed.
        shot.target = null;
      }
    }
    const dx = shot.tx - shot.x;
    const dy = shot.ty - shot.y;
    const dist = Math.hypot(dx, dy);
    const travel = shot.speed * dt;
    if (dist <= travel + 4) {
      shot.x = shot.tx;
      shot.y = shot.ty;
      shot.dead = true;
      impact(world, shot.x, shot.y, shot.damage, shot.splash, shot.team, shot.target, shot.kind);
      continue;
    }
    shot.x += (dx / dist) * travel;
    shot.y += (dy / dist) * travel;
  }
  if (world.projectiles.some((shot) => shot.dead)) {
    world.projectiles = world.projectiles.filter((shot) => !shot.dead);
  }
}

function impact(
  world: World,
  x: number,
  y: number,
  damage: number,
  splash: number,
  team: Team,
  target: TargetRef | null,
  kind: ProjectileKind,
): void {
  if (splash > 0) {
    dealSplash(world, x, y, splash, damage, team);
    addEffect(world, {
      kind: "blast",
      x,
      y,
      radius: splash,
      life: 0.3,
      maxLife: 0.3,
      color: kind === "spell" ? "#9d7bff" : "#ffb36b",
    });
    return;
  }
  if (target) {
    dealDamage(world, target, damage);
  }
  addEffect(world, {
    kind: "spark",
    x,
    y,
    radius: 7,
    life: 0.18,
    maxLife: 0.18,
    color: team === "island" ? "#ffe6a8" : "#8ce8ff",
  });
}

export { spawnProjectile, updateProjectiles };
