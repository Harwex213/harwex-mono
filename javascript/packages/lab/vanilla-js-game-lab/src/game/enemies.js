import { EDGE_CELLS, cellToWorld, isCenter, keyOf, neighbors } from "./hex.js"

/**
 * Enemy registry. Add a type by adding an entry — spawning, scaling and
 * rendering pick it up automatically.
 * speed = cells/sec, weight = spawn lottery tickets, fromDay = unlock day.
 */
export const ENEMIES = {
  grunt: { name: "Grunt", emoji: "👾", hp: 20, speed: 1.0, coins: 5, dmg: 5, fromDay: 1, weight: 10 },
  runner: { name: "Runner", emoji: "🦇", hp: 8, speed: 2.2, coins: 4, dmg: 3, fromDay: 3, weight: 4 },
}

export const hpScale = (day) => 1.2 ** (day - 1)
export const coinScale = (day) => 1.15 ** (day - 1)

/** @param {import("../types.js").Enemy} e @returns {{x: number, y: number}} */
export function enemyPos(e) {
  const from = cellToWorld(e.cell)
  if (!e.next) {
    return from
  }
  const to = cellToWorld(e.next)
  return {
    x: from.x + (to.x - from.x) * e.progress,
    y: from.y + (to.y - from.y) * e.progress,
  }
}

/** Neighbor one step closer to the base, random among ties. Null if trapped. */
export function pickNext(s, cell) {
  const here = s.flow[keyOf(cell)]
  if (here === undefined) {
    return null
  }
  let best = null
  let bestDist = here
  let ties = 0
  for (const n of neighbors(cell)) {
    const d = s.flow[keyOf(n)]
    if (d === undefined || d > bestDist) {
      continue
    }
    if (d < bestDist) {
      bestDist = d
      best = n
      ties = 1
    } else if (Math.random() < 1 / ++ties) {
      best = n
    }
  }
  return best
}

/** @param {import("../types.js").GameState} s */
export function spawnEnemy(s) {
  const spawnable = EDGE_CELLS.filter((c) => s.flow[keyOf(c)] !== undefined)
  if (spawnable.length === 0) {
    return
  }
  const cell = spawnable[Math.floor(Math.random() * spawnable.length)]

  const pool = Object.entries(ENEMIES).filter(([, def]) => def.fromDay <= s.day)
  const total = pool.reduce((sum, [, def]) => sum + def.weight, 0)
  let roll = Math.random() * total
  const [type, def] = pool.find(([, d]) => (roll -= d.weight) <= 0) ?? pool[0]

  const hp = Math.round(def.hp * hpScale(s.day))
  s.enemies.push({
    id: s.nextId++,
    type,
    hp,
    maxHp: hp,
    coins: Math.floor(def.coins * coinScale(s.day)),
    dmg: def.dmg,
    speed: def.speed,
    cell,
    next: pickNext(s, cell),
    progress: 0,
  })
}

/** @param {import("../types.js").GameState} s */
export function tickEnemies(s, dt) {
  for (const e of s.enemies) {
    if (!e.next) {
      e.next = pickNext(s, e.cell)
      continue
    }
    e.progress += e.speed * dt
    while (e.progress >= 1) {
      e.progress -= 1
      e.cell = e.next
      if (isCenter(e.cell)) {
        s.baseHp -= e.dmg
        e.dead = true
        break
      }
      e.next = pickNext(s, e.cell)
      if (!e.next) {
        e.progress = 0
        break
      }
    }
  }
  s.enemies = s.enemies.filter((e) => !e.dead)
}
