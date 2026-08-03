import { useSignals } from "@preact/signals-react/runtime";
import type { ReactNode } from "react";
import { HEX_INSET, HEX_SIZE, hexPoints, type HexCell } from "./hex-layout";
import { grid, selectedKey, terrainOf } from "../state/grid-state";
import styles from "./hex-grid.module.css";

const POINTS = hexPoints(HEX_SIZE - HEX_INSET);

// World-space content for `HexCanvas`: the layer never sees the pan/zoom
// transform, it just draws the grid at its own coordinates. `children` land on
// top of the terrain, which is where a page puts its own units.
function HexGridLayer({ children }: { children?: ReactNode }) {
  useSignals();

  const selected = selectedKey.value;

  return (
    <>
      {grid.cells.map((cell) => (
        <Hex key={cell.key} cell={cell} selected={cell.key === selected} />
      ))}
      {children}
    </>
  );
}

function Hex({ cell, selected }: { cell: HexCell; selected: boolean }) {
  const terrain = styles[terrainOf(cell.key)];

  return (
    <polygon
      className={selected ? `${styles.hex} ${terrain} ${styles.selected}` : `${styles.hex} ${terrain}`}
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
