import { HEX_CORNERS, hexToPoint } from "./layout";
import { HEX_DIRECTIONS } from "./coords";
import type { TAxial } from "./coords";

/**
 * Outline of the coast. Every hex edge with water on the far side becomes one
 * segment, so the shared edges inside the island are left out. Corner `i` and
 * corner `i + 1` bound the edge towards neighbour `i`.
 */
const coastlinePath = (cells: readonly TAxial[], isLand: (q: number, r: number) => boolean) => {
  const parts: string[] = [];

  for (const cell of cells) {
    const centre = hexToPoint(cell);

    HEX_DIRECTIONS.forEach((offset, edge) => {
      if (isLand(cell.q + offset.q, cell.r + offset.r)) {
        return;
      }

      const from = HEX_CORNERS[edge]!;
      const to = HEX_CORNERS[(edge + 1) % 6]!;

      parts.push(
        `M${(centre.x + from.x).toFixed(2)} ${(centre.y + from.y).toFixed(2)}` +
          `L${(centre.x + to.x).toFixed(2)} ${(centre.y + to.y).toFixed(2)}`
      );
    });
  }

  return parts.join("");
};

export { coastlinePath };
