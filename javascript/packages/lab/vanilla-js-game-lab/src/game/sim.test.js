import { test } from "node:test"
import assert from "node:assert/strict"

import { createInitialState, tickSim, clickAt, CYCLE, DAY_HALF } from "./sim.js"
import { canPlace, place, priceOf, sellAt, BUILDINGS } from "./buildings.js"
import { CELLS, EDGE_CELLS, keyOf, neighbors, worldToCell, cellToWorld, computeFlow } from "./hex.js"

const DT = 1 / 20

function run(s, seconds) {
  for (let t = 0; t < seconds; t += DT) {
    tickSim(s, DT)
  }
}

test("board is a radius-5 hexagon", () => {
  assert.equal(CELLS.length, 91)
  assert.equal(EDGE_CELLS.length, 30)
})

test("world/cell round-trips", () => {
  for (const cell of CELLS) {
    const p = cellToWorld(cell)
    assert.deepEqual(worldToCell(p.x, p.y), cell)
  }
})

test("flow field covers the empty board and descends to the base", () => {
  const flow = computeFlow(new Set())
  assert.equal(Object.keys(flow).length, 91)
  assert.equal(flow["0,0"], 0)
  for (const edge of EDGE_CELLS) {
    assert.equal(flow[keyOf(edge)], 5)
  }
})

test("day phase is calm, night spawns enemies", () => {
  const s = createInitialState()
  run(s, DAY_HALF - 1)
  assert.equal(s.enemies.length, 0)
  assert.equal(s.phase, "day")
  run(s, CYCLE - DAY_HALF)
  assert.equal(s.phase, "night")
  // spawned counter, not live count — undefended enemies reach the base and despawn
  const spawned = s.nextId - 1
  assert.ok(spawned > 5, `expected a night trickle, got ${spawned} spawns`)
})

test("enemies reach the base and damage it", () => {
  const s = createInitialState()
  run(s, CYCLE * 2)
  assert.ok(s.baseHp < s.baseMaxHp, "undefended base should take hits")
})

test("placement: costs scale, center and sealing are rejected", () => {
  const s = createInitialState()
  s.coins = 10_000
  assert.equal(canPlace(s, { q: 0, r: 0 }, "wall").ok, false)
  assert.equal(canPlace(s, { q: 99, r: 0 }, "wall").ok, false)

  const p0 = priceOf("wall", 0)
  place(s, { q: 1, r: 0 }, "wall")
  assert.equal(priceOf("wall", s.counts.wall), Math.floor(BUILDINGS.wall.cost * 1.15))
  assert.ok(priceOf("wall", 1) > p0)

  // wall off 5 of 6 base neighbors (one already placed above) — allowed; the 6th must be rejected
  const ring = neighbors({ q: 0, r: 0 })
  for (const cell of ring.slice(1, 5)) {
    assert.equal(canPlace(s, cell, "wall").ok, true, `ring cell ${keyOf(cell)}`)
    place(s, cell, "wall")
  }
  assert.equal(canPlace(s, ring[5], "wall").ok, false, "sealing the base must be rejected")
  assert.match(canPlace(s, ring[5], "wall").reason, /seal/)
})

test("mine unlocks on day 2 and produces income", () => {
  const s = createInitialState()
  assert.equal(canPlace(s, { q: 2, r: 0 }, "mine").ok, false)
  s.time = CYCLE // day 2
  run(s, DT)
  assert.equal(s.day, 2)
  assert.equal(canPlace(s, { q: 2, r: 0 }, "mine").ok, true)
  place(s, { q: 2, r: 0 }, "mine")
  const before = s.coins
  s.time = CYCLE // rewind to calm phase so no enemy noise
  run(s, 10)
  assert.ok(s.coins >= before + 9.9, "mine should pay ~1/s")
})

test("a tower defends: fewer base hits than undefended", () => {
  const defended = createInitialState()
  defended.coins = 10_000
  for (const cell of [{ q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 }, { q: 0, r: -1 }]) {
    place(defended, cell, "tower")
  }
  const open = createInitialState()
  run(defended, CYCLE * 2)
  run(open, CYCLE * 2)
  assert.ok(defended.baseHp > open.baseHp, "towers should reduce damage taken")
  assert.ok(defended.coins > 0)
})

test("clicks earn coins and damage enemies", () => {
  const s = createInitialState()
  clickAt(s, { x: 3, y: 3 }, worldToCell(3, 3))
  assert.equal(Math.floor(s.coins), 51)

  s.enemies.push({
    id: 1, type: "grunt", hp: 3, maxHp: 20, coins: 5, dmg: 5, speed: 1,
    cell: { q: 3, r: 0 }, next: null, progress: 0,
  })
  const pos = cellToWorld({ q: 3, r: 0 })
  clickAt(s, pos, { q: 3, r: 0 })
  assert.equal(s.enemies.length, 0, "click damage should finish a 3hp enemy")
  assert.equal(Math.floor(s.coins), 51 + 1 + 5)
})

test("selling refunds half the current price tier", () => {
  const s = createInitialState()
  const cell = { q: 1, r: 0 }
  place(s, cell, "wall")
  const coinsBefore = s.coins
  const refund = sellAt(s, cell)
  assert.equal(refund, Math.floor(priceOf("wall", 0) * 0.5))
  assert.equal(s.coins, coinsBefore + refund)
  assert.equal(s.counts.wall, 0)
  assert.equal(Object.keys(s.buildings).length, 0)
})

test("game over stops the sim; state stays JSON-serializable", () => {
  const s = createInitialState()
  s.baseHp = 1
  run(s, CYCLE * 3)
  assert.equal(s.gameOver, true)
  assert.equal(s.baseHp, 0)
  const time = s.time
  run(s, 10)
  assert.equal(s.time, time, "sim must freeze after game over")
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s)
})
