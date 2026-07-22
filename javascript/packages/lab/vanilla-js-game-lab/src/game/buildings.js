import { CELL_KEYS, EDGE_CELLS, computeFlow, isCenter, keyOf } from "./hex.js"
import { pickNext } from "./enemies.js"

/**
 * Building registry. Add a type by adding an entry — the build menu, pricing
 * and unlocks pick it up automatically; give it behavior in combat.js/sim.js.
 * cost = base price (grows ×COST_GROWTH per owned copy), fromDay = unlock day.
 */
export const BUILDINGS = {
  wall: { name: "Wall", emoji: "🧱", cost: 10, fromDay: 1, info: "Blocks the path" },
  tower: { name: "Arrow Tower", emoji: "🏹", cost: 25, fromDay: 1, info: "5 dmg · range 2 · 1/s", range: 2, damage: 5, rate: 1 },
  mine: { name: "Coin Mine", emoji: "⛏️", cost: 40, fromDay: 2, info: "+1 💰/s", income: 1 },
}

export const COST_GROWTH = 1.15
export const SELL_RATIO = 0.5

export const priceOf = (type, count) => Math.floor(BUILDINGS[type].cost * COST_GROWTH ** count)

export const blockedKeys = (s) => new Set(Object.keys(s.buildings))

/**
 * @param {import("../types.js").GameState} s
 * @param {{q: number, r: number} | null} cell
 * @param {string} type
 * @returns {{ok: boolean, reason?: string}}
 */
export function canPlace(s, cell, type) {
  if (!cell || !CELL_KEYS.has(keyOf(cell))) {
    return { ok: false, reason: "off board" }
  }
  if (isCenter(cell)) {
    return { ok: false, reason: "base cell" }
  }
  if (s.buildings[keyOf(cell)]) {
    return { ok: false, reason: "occupied" }
  }
  if (BUILDINGS[type].fromDay > s.day) {
    return { ok: false, reason: "locked" }
  }
  if (s.coins < priceOf(type, s.counts[type])) {
    return { ok: false, reason: "too expensive" }
  }

  const onEnemy = s.enemies.some(
    (e) => keyOf(e.cell) === keyOf(cell) || (e.next && keyOf(e.next) === keyOf(cell)),
  )
  if (onEnemy) {
    return { ok: false, reason: "enemy in the way" }
  }

  // Reject placements that seal any spawn edge or trap an enemy.
  const blocked = blockedKeys(s)
  blocked.add(keyOf(cell))
  const flow = computeFlow(blocked)
  for (const edge of EDGE_CELLS) {
    const k = keyOf(edge)
    if (flow[k] === undefined && !blocked.has(k)) {
      return { ok: false, reason: "would seal the path" }
    }
  }
  for (const e of s.enemies) {
    if (flow[keyOf(e.cell)] === undefined) {
      return { ok: false, reason: "would trap an enemy" }
    }
  }
  return { ok: true }
}

/** Place `type` at cell, deduct coins, reroute enemies. Assumes canPlace ok. */
export function place(s, cell, type) {
  s.coins -= priceOf(type, s.counts[type])
  s.counts[type]++
  s.buildings[keyOf(cell)] = { type }
  s.flow = computeFlow(blockedKeys(s))
  for (const e of s.enemies) {
    if (e.next && keyOf(e.next) === keyOf(cell)) {
      e.next = pickNext(s, e.cell)
      e.progress = 0
    }
  }
}

/** Sell the building at cell for SELL_RATIO of its current price tier. */
export function sellAt(s, cell) {
  const b = s.buildings[keyOf(cell)]
  if (!b) {
    return 0
  }
  const refund = Math.floor(priceOf(b.type, s.counts[b.type] - 1) * SELL_RATIO)
  s.coins += refund
  s.counts[b.type]--
  delete s.buildings[keyOf(cell)]
  s.flow = computeFlow(blockedKeys(s))
  return refund
}
