import { useSignals } from "@preact/signals-react/runtime";
import type { ReactNode } from "react";
import { HEX_INSET, HEX_SIZE, hexPoints, type HexCell } from "./hex-layout";
import { grid, selectedCell, terrainOf } from "../state/grid-state";
import styles from "./hex-grid.module.css";

const POINTS = hexPoints(HEX_SIZE - HEX_INSET);

// World-space content for `HexCanvas`: the layer never sees the pan/zoom
// transform, it just draws the grid at its own coordinates. `children` land
// between the terrain and the selection ring, which is where a page puts its
// own units.
function HexGridLayer({ children }: { children?: ReactNode }) {
  useSignals();

  const selected = selectedCell.value;

  return (
    <>
      {grid.cells.map((cell) => (
        <Hex key={cell.key} cell={cell} />
      ))}
      {children}
      {/* SVG paints in document order, so the selection ring goes last —
          drawn inside the loop, the next hexes would clip it. */}
      {selected === null ? null : (
        <polygon className={styles.selected} points={POINTS} transform={translate(selected)} />
      )}
    </>
  );
}

function Hex({ cell }: { cell: HexCell }) {
  return (
    <polygon
      className={`${styles.hex} ${styles[terrainOf(cell.key)]}`}
      data-cell-key={cell.key}
      points={POINTS}
      transform={translate(cell)}
    />
  );
}

function translate(cell: HexCell): string {
  return `translate(${cell.x.toFixed(2)} ${cell.y.toFixed(2)})`;
}

export { HexGridLayer };
