/** Axial hex math for a pointy-top hexagon board. World unit = 1 hex size. */

export const RADIUS = 5
const SQRT3 = Math.sqrt(3)

export const DIRS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

/** @param {{q: number, r: number}} cell */
export const keyOf = (cell) => `${cell.q},${cell.r}`

/** @param {string} key */
export function cellOf(key) {
  const [q, r] = key.split(",").map(Number)
  return { q, r }
}

/** All cells of the hexagon board, radius RADIUS around origin. */
export const CELLS = (() => {
  const cells = []
  for (let q = -RADIUS; q <= RADIUS; q++) {
    for (let r = -RADIUS; r <= RADIUS; r++) {
      if (Math.abs(q + r) <= RADIUS) {
        cells.push({ q, r })
      }
    }
  }
  return cells
})()

export const CELL_KEYS = new Set(CELLS.map(keyOf))

export const CENTER = { q: 0, r: 0 }

export const isCenter = (cell) => cell.q === 0 && cell.r === 0

export function hexDist(a, b) {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

export const isEdge = (cell) => hexDist(cell, CENTER) === RADIUS

export const EDGE_CELLS = CELLS.filter(isEdge)

export function neighbors(cell) {
  const out = []
  for (const d of DIRS) {
    const n = { q: cell.q + d.q, r: cell.r + d.r }
    if (CELL_KEYS.has(keyOf(n))) {
      out.push(n)
    }
  }
  return out
}

/** @returns {{x: number, y: number}} World position of cell center. */
export function cellToWorld(cell) {
  return {
    x: SQRT3 * (cell.q + cell.r / 2),
    y: 1.5 * cell.r,
  }
}

/** @returns {{q: number, r: number} | null} Board cell at world point, or null. */
export function worldToCell(x, y) {
  const rf = y / 1.5
  const qf = x / SQRT3 - rf / 2
  const cell = roundAxial(qf, rf)
  return CELL_KEYS.has(keyOf(cell)) ? cell : null
}

function roundAxial(qf, rf) {
  const sf = -qf - rf
  let q = Math.round(qf)
  let r = Math.round(rf)
  const s = Math.round(sf)
  const dq = Math.abs(q - qf)
  const dr = Math.abs(r - rf)
  const ds = Math.abs(s - sf)
  if (dq > dr && dq > ds) {
    q = -r - s
  } else if (dr > ds) {
    r = -q - s
  }
  return { q, r }
}

/**
 * BFS distance-to-base over unblocked cells. Blocked cells get no entry —
 * enemies path by descending distance, so one field serves pathing and
 * placement validation both.
 *
 * @param {Set<string>} blocked Cell keys occupied by buildings.
 * @returns {Object<string, number>}
 */
export function computeFlow(blocked) {
  const flow = { [keyOf(CENTER)]: 0 }
  const queue = [CENTER]
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i]
    const dist = flow[keyOf(cell)]
    for (const n of neighbors(cell)) {
      const k = keyOf(n)
      if (k in flow || blocked.has(k)) {
        continue
      }
      flow[k] = dist + 1
      queue.push(n)
    }
  }
  return flow
}
