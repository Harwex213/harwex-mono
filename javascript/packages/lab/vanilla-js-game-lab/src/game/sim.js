import { computeFlow } from "./hex.js"
import { spawnEnemy, tickEnemies, enemyPos } from "./enemies.js"
import { tickCombat, hitEnemy } from "./combat.js"
import { BUILDINGS, canPlace, place, sellAt } from "./buildings.js"
import { addPopup, tickEffects } from "./effects.js"

export const CYCLE = 60 // seconds per day
export const DAY_HALF = 30 // calm building phase; night trickle after
export const CLICK_COINS = 1
export const CLICK_DAMAGE = 3
const CLICK_RADIUS = 0.9 // world units, forgiving hitbox

/** Enemies per second during the night phase. */
const spawnRate = (day) => 0.4 + 0.12 * (day - 1)

/** @returns {import("../types.js").GameState} */
export function createInitialState() {
  return {
    time: 0,
    day: 1,
    phase: "day",
    coins: 50,
    baseHp: 100,
    baseMaxHp: 100,
    buildings: {},
    counts: Object.fromEntries(Object.keys(BUILDINGS).map((t) => [t, 0])),
    enemies: [],
    projectiles: [],
    effects: [],
    flow: computeFlow(new Set()),
    selected: null,
    spawnAcc: 0,
    nextId: 1,
    gameOver: false,
  }
}

/** Advance the whole simulation one fixed step. */
export function tickSim(s, dt) {
  if (s.gameOver) {
    return
  }

  s.time += dt
  s.day = Math.floor(s.time / CYCLE) + 1
  s.phase = s.time % CYCLE < DAY_HALF ? "day" : "night"

  if (s.phase === "night") {
    s.spawnAcc += spawnRate(s.day) * dt
    while (s.spawnAcc >= 1) {
      s.spawnAcc -= 1
      spawnEnemy(s)
    }
  }

  tickEnemies(s, dt)
  tickCombat(s, dt)

  for (const b of Object.values(s.buildings)) {
    const income = BUILDINGS[b.type].income
    if (income) {
      s.coins += income * dt
    }
  }

  tickEffects(s, dt)

  if (s.baseHp <= 0) {
    s.baseHp = 0
    s.gameOver = true
    s.selected = null
  }
}

/**
 * Canvas click: place when a building is armed; otherwise hit an enemy,
 * sell a building, or just collect the click coin.
 */
export function clickAt(s, world, cell) {
  if (s.gameOver) {
    return
  }

  if (s.selected) {
    if (canPlace(s, cell, s.selected).ok) {
      place(s, cell, s.selected)
    }
    return
  }

  let closest = null
  let closestDist = CLICK_RADIUS
  for (const e of s.enemies) {
    const pos = enemyPos(e)
    const d = Math.hypot(pos.x - world.x, pos.y - world.y)
    if (d < closestDist) {
      closestDist = d
      closest = e
    }
  }
  if (closest) {
    s.coins += CLICK_COINS
    hitEnemy(s, closest, CLICK_DAMAGE)
    s.enemies = s.enemies.filter((e) => !e.dead)
    addPopup(s, world.x, world.y - 0.4, `-${CLICK_DAMAGE}`, "tomato")
    return
  }

  if (cell && s.buildings[`${cell.q},${cell.r}`]) {
    const refund = sellAt(s, cell)
    addPopup(s, world.x, world.y, `+${refund} 💰`, "gold")
    return
  }

  s.coins += CLICK_COINS
  addPopup(s, world.x, world.y, `+${CLICK_COINS} 💰`, "gold")
}
