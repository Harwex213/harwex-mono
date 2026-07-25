import { hexDistance } from "./hex-facing.js";
import { axialRound, axialToOffset, offsetToAxial } from "./hex-layout.js";

/**
 * Cells along the straight hex line from `from` to `to`, endpoints included.
 * Cube-lerp + `axialRound` at each step.
 * @param {{row: number, col: number}} from
 * @param {{row: number, col: number}} to
 * @returns {{row: number, col: number}[]}
 */
const hexLine = (from, to) => {
  const a = offsetToAxial(from.col, from.row);
  const b = offsetToAxial(to.col, to.row);
  const n = hexDistance(from, to);
  const cells = [];
  for (let i = 0; i <= n; i += 1) {
    const t = n === 0 ? 0 : i / n;
    const q = a.q + (b.q - a.q) * t;
    const r = a.r + (b.r - a.r) * t;
    const rounded = axialRound(q, r);
    const off = axialToOffset(rounded.q, rounded.r);
    cells.push({ row: off.row, col: off.col });
  }
  return cells;
};

/**
 * @param {{row: number, col: number}} from
 * @param {{row: number, col: number}} to
 * @returns {{row: number, col: number}[]} intermediates strictly between the two endpoints
 */
const losCells = (from, to) => hexLine(from, to).slice(1, -1);

/**
 * Direct-fire LoS is blocked when an intermediate hex has `blocksDirectLos`
 * terrain, or is occupied by a unit that is not on lower ground than the
 * shooter (doc: can shoot over units only if a level lower).
 * @param {{row: number, col: number}} from
 * @param {{row: number, col: number}} to
 * @param {{ terrainAt: (row: number, col: number) => TerrainDef, unitAt: (row: number, col: number) => (object|null), shooterElevation: number }} ctx
 * @returns {boolean}
 */
const directLosBlocked = (from, to, ctx) => {
  for (const cell of losCells(from, to)) {
    const t = ctx.terrainAt(cell.row, cell.col);
    if (t.blocksDirectLos) {
      return true;
    }
    const occupied = ctx.unitAt(cell.row, cell.col);
    if (occupied && (t.elevation ?? 0) >= ctx.shooterElevation) {
      return true;
    }
  }
  return false;
};

/**
 * Arc fire passes over units; only `blocksArcFire` terrain (mountain) blocks it.
 * @param {{row: number, col: number}} from
 * @param {{row: number, col: number}} to
 * @param {{ terrainAt: (row: number, col: number) => TerrainDef }} ctx
 * @returns {boolean}
 */
const arcBlocked = (from, to, ctx) => {
  for (const cell of losCells(from, to)) {
    if (ctx.terrainAt(cell.row, cell.col).blocksArcFire) {
      return true;
    }
  }
  return false;
};

export { hexLine, losCells, directLosBlocked, arcBlocked };
