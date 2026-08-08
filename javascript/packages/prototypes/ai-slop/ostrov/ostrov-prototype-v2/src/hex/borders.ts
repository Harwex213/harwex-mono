import type { Axial } from "./coords";
import { HEX_DIRECTIONS } from "./coords";
import type { Point } from "./layout";
import { hexCorners, hexToWorld } from "./layout";

type Segment = {
  a: Point;
  b: Point;
};

/** Resolves the owner of a hex; `null` means the hex is not part of the island. */
type OwnerLookup = (q: number, r: number) => number | null;

/**
 * Collects the outline of one owner's territory: every hex edge where the
 * neighbour belongs to somebody else or to nothing at all.
 */
function territoryEdges(hexes: readonly Axial[], ownerOf: OwnerLookup, owner: number): Segment[] {
  const segments: Segment[] = [];
  for (const hex of hexes) {
    if (ownerOf(hex.q, hex.r) !== owner) {
      continue;
    }
    const corners = hexCorners(hexToWorld(hex));
    for (let edge = 0; edge < HEX_DIRECTIONS.length; edge += 1) {
      const offset = HEX_DIRECTIONS[edge]!;
      if (ownerOf(hex.q + offset.q, hex.r + offset.r) === owner) {
        continue;
      }
      segments.push({
        a: corners[edge]!,
        b: corners[(edge + 1) % 6]!,
      });
    }
  }
  return segments;
}

function pointKey(point: Point): string {
  return `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`;
}

/**
 * Stitches loose segments into polylines so the stroke gets real joins instead
 * of a row of separately capped sticks.
 */
function chainSegments(segments: readonly Segment[]): Point[][] {
  const byStart = new Map<string, number[]>();
  for (let index = 0; index < segments.length; index += 1) {
    const key = pointKey(segments[index]!.a);
    const bucket = byStart.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      byStart.set(key, [index]);
    }
  }

  const used = new Array<boolean>(segments.length).fill(false);
  const chains: Point[][] = [];

  const take = (key: string): number | null => {
    const bucket = byStart.get(key);
    if (!bucket) {
      return null;
    }
    while (bucket.length > 0) {
      const index = bucket.pop()!;
      if (!used[index]) {
        return index;
      }
    }
    return null;
  };

  for (let index = 0; index < segments.length; index += 1) {
    if (used[index]) {
      continue;
    }
    used[index] = true;
    const first = segments[index]!;
    const chain: Point[] = [first.a, first.b];
    let cursor = pointKey(first.b);
    for (;;) {
      const next = take(cursor);
      if (next === null) {
        break;
      }
      used[next] = true;
      chain.push(segments[next]!.b);
      cursor = pointKey(segments[next]!.b);
    }
    chains.push(chain);
  }
  return chains;
}

export type { OwnerLookup, Segment };
export { chainSegments, territoryEdges };
