/**
 * View layer — hex rendering geometry.
 *
 * Pure pixel helpers for the SVG grid, built on the Model's pointy-top
 * {@link axialToPixel} so screen geometry and the engine's bearings agree
 * (this is what makes the facing arrow line up with the §2.2 zones). Nothing
 * here touches MobX or React.
 */

import { HEX_DIRECTIONS, HEX_DIRECTION_COUNT, axialToPixel } from '@/model/hex';
import type { Axial, Facing } from '@/model/types';

/** A 2D pixel point. */
export interface Point {
  x: number;
  y: number;
}

/** Pixel centre of a hex (pointy-top), with `size` the circumradius. */
export function hexCenter(coord: Axial, size: number): Point {
  return axialToPixel(coord, size);
}

/**
 * The six pixel corners of a pointy-top hex of circumradius `size`, centred at
 * `center`, as an SVG `points` string. Corners sit at 60° steps offset by −30°.
 */
export function hexCornersPath(center: Point, size: number): string {
  const corners: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    corners.push(`${center.x + size * Math.cos(angle)},${center.y + size * Math.sin(angle)}`);
  }
  return corners.join(' ');
}

/**
 * Unit vector (screen space) pointing where a unit's facing aims — the shared
 * vertex between direction `facing` and `facing + 1` (§2.2). Used to draw the
 * facing arrow on a token.
 */
export function facingVector(facing: Facing): Point {
  const a = axialToPixel(HEX_DIRECTIONS[facing]);
  const b = axialToPixel(HEX_DIRECTIONS[(facing + 1) % HEX_DIRECTION_COUNT]);
  const x = a.x + b.x;
  const y = a.y + b.y;
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

/** Pixel size of a pointy-top hex of circumradius `size`. */
export function hexPixelSize(size: number): { width: number; height: number } {
  return { width: Math.sqrt(3) * size, height: 2 * size };
}
