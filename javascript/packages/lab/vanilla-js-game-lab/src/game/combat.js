import { cellOf, cellToWorld, hexDist, keyOf } from "./hex.js"
import { enemyPos } from "./enemies.js"
import { BUILDINGS } from "./buildings.js"
import { addPopup } from "./effects.js"

const PROJECTILE_SPEED = 6
const HIT_RADIUS = 0.15

/** Apply damage; on kill, pay the bounty. */
export function hitEnemy(s, enemy, damage) {
  enemy.hp -= damage
  if (enemy.hp > 0 || enemy.dead) {
    return
  }
  enemy.dead = true
  s.coins += enemy.coins
  const pos = enemyPos(enemy)
  addPopup(s, pos.x, pos.y, `+${enemy.coins} 💰`, "gold")
}

/** Towers fire at the in-range enemy closest to the base; arrows always land. */
export function tickCombat(s, dt) {
  for (const [key, b] of Object.entries(s.buildings)) {
    const def = BUILDINGS[b.type]
    if (!def.damage) {
      continue
    }
    b.cd = (b.cd ?? 0) - dt
    if (b.cd > 0) {
      continue
    }
    const cell = cellOf(key)
    const target = pickTarget(s, cell, def.range)
    if (!target) {
      continue
    }
    b.cd = 1 / def.rate
    const pos = cellToWorld(cell)
    s.projectiles.push({ x: pos.x, y: pos.y, targetId: target.id, damage: def.damage, speed: PROJECTILE_SPEED })
  }

  for (const p of s.projectiles) {
    const target = s.enemies.find((e) => e.id === p.targetId && !e.dead)
    if (!target) {
      p.dead = true
      continue
    }
    const tp = enemyPos(target)
    const dx = tp.x - p.x
    const dy = tp.y - p.y
    const dist = Math.hypot(dx, dy)
    const step = p.speed * dt
    if (dist <= step + HIT_RADIUS) {
      hitEnemy(s, target, p.damage)
      p.dead = true
    } else {
      p.x += (dx / dist) * step
      p.y += (dy / dist) * step
    }
  }

  s.projectiles = s.projectiles.filter((p) => !p.dead)
  s.enemies = s.enemies.filter((e) => !e.dead)
}

function pickTarget(s, cell, range) {
  let best = null
  let bestDist = Infinity
  for (const e of s.enemies) {
    if (hexDist(cell, e.cell) > range) {
      continue
    }
    const toBase = s.flow[keyOf(e.cell)] ?? Infinity
    if (toBase < bestDist) {
      bestDist = toBase
      best = e
    }
  }
  return best
}
