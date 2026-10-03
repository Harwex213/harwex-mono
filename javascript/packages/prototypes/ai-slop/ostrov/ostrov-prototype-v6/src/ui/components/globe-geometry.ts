import * as THREE from "three";
import type { TVec3, TWorld, TWorldCell } from "../../core/world-gen";

/**
 * One merged mesh for every cell of the globe. Each cell is a fan of
 * triangles over its polygon, subdivided and pushed onto the sphere. Every
 * vertex carries:
 *
 * - `aCell`: the cell index, to read the per-cell state texture;
 * - `aEdge`: 0 at the cell centre, 1 on its border, for outlines;
 * - `aLocal`: the position in the cell's own tangent plane, turned by the
 *   cell variant, 1 at a corner. The tile art is sampled with it;
 * - `aTile`: which atlas slot this cell draws when it is revealed.
 */

/** Rows of each fan triangle. Enough to keep the flat pieces on the sphere. */
const FAN_STEPS = 3;

/** Atlas slots, in the order `globe-atlas.ts` packs them. */
const TILE_SLOTS = {
  island: [0, 1, 2],
  settlement: 3,
  cloud: 4,
} as const;

const tileOf = (cell: TWorldCell) => {
  if (cell.kind === "settlement") {
    return TILE_SLOTS.settlement;
  }

  if (cell.kind === "island") {
    return TILE_SLOTS.island[cell.variant % TILE_SLOTS.island.length] ?? 0;
  }

  return TILE_SLOTS.cloud;
};

const toVector = (v: TVec3) => new THREE.Vector3(v[0], v[1], v[2]);

const buildGlobeGeometry = (world: TWorld) => {
  const positions: number[] = [];
  const cellIndex: number[] = [];
  const edges: number[] = [];
  const locals: number[] = [];
  const tiles: number[] = [];
  const indices: number[] = [];

  const point = new THREE.Vector3();
  const rim = new THREE.Vector3();
  const flat = new THREE.Vector3();

  for (const cell of world.cells) {
    const center = toVector(cell.center);
    const corners = cell.polygon.map(toVector);
    const first = corners[0] ?? new THREE.Vector3(1, 0, 0);

    // A tangent basis turned by the variant, so equal tiles do not look alike.
    const angle = (cell.variant % 6) * (Math.PI / 3) + cell.variant * 0.37;
    const east = first.clone().divideScalar(first.dot(center)).sub(center);
    const radius = east.length() || 1;
    east.normalize();
    const north = new THREE.Vector3().crossVectors(center, east).normalize();
    const turnedEast = east.clone().multiplyScalar(Math.cos(angle)).addScaledVector(north, Math.sin(angle));
    const turnedNorth = new THREE.Vector3().crossVectors(center, turnedEast).normalize();
    const tile = tileOf(cell);

    for (let side = 0; side < corners.length; side += 1) {
      const a = corners[side] as THREE.Vector3;
      const b = corners[(side + 1) % corners.length] as THREE.Vector3;
      const base = positions.length / 3;

      for (let row = 0; row <= FAN_STEPS; row += 1) {
        const r = row / FAN_STEPS;

        for (let column = 0; column <= row; column += 1) {
          const t = row === 0 ? 0 : column / row;
          rim.copy(a).lerp(b, t);
          point.copy(center).lerp(rim, r).normalize();
          positions.push(point.x, point.y, point.z);
          cellIndex.push(cell.index);
          edges.push(r);
          tiles.push(tile);

          // Gnomonic projection keeps the hex edges straight in tile space.
          flat.copy(point).divideScalar(point.dot(center)).sub(center);
          locals.push(flat.dot(turnedEast) / radius, flat.dot(turnedNorth) / radius);
        }
      }

      const rowStart = (row: number) => base + (row * (row + 1)) / 2;

      for (let row = 0; row < FAN_STEPS; row += 1) {
        for (let column = 0; column <= row; column += 1) {
          const top = rowStart(row) + column;
          const left = rowStart(row + 1) + column;
          const right = left + 1;
          indices.push(top, left, right);

          if (column < row) {
            indices.push(top, right, top + 1);
          }
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aCell", new THREE.Float32BufferAttribute(cellIndex, 1));
  geometry.setAttribute("aEdge", new THREE.Float32BufferAttribute(edges, 1));
  geometry.setAttribute("aLocal", new THREE.Float32BufferAttribute(locals, 2));
  geometry.setAttribute("aTile", new THREE.Float32BufferAttribute(tiles, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return geometry;
};

export { buildGlobeGeometry };
