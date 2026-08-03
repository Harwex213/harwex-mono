import { useSignals } from "@preact/signals-react/runtime";
import type { ReactNode } from "react";
import { HEX_GAP, HEX_INSET, HEX_SIZE, type HexCell, hexPoints, hexRingPoints } from "./hex-layout";
import { cellOf, grid, hoveredKey, selectedKey, terrainOf } from "../state/grid-state";
import styles from "./hex-grid.module.css";

const POINTS = hexPoints(HEX_SIZE - HEX_INSET);

// Half the hex's own outline, which is `stroke-width: 2` straddling the edge.
const OUTLINE_HALF = 1;

// A hover or select state paints two shapes in one colour: the hex's own
// outline, and a band that carries that colour on across the gap. Together they
// cover the outline and the background behind it, and stop where the
// neighbour's outline starts. The neighbour keeps its line whole.
//
// The band is measured perpendicular to a hex edge, with the hex outline at zero
// and outward positive. It is drawn under every hex, which is what makes both of
// its ends exact:
//
//   - the inner end sits under the hex itself, so the visible band starts at the
//     outer edge of the hex's own outline, whatever that outline is drawn at;
//   - the outer end sits under the neighbour's outline, so the visible band
//     stops dead on that outline's inner edge.
//
// Neither end draws an edge of its own, so neither can leave the hairline that
// two coincident antialiased edges do. `OVERLAP` is how far each end runs past
// the shape that hides it — half a pixel is enough to bury the antialiasing.
const OVERLAP = 0.5;

// Both ends are one overlap short of the shape that hides them: `OUTLINE_HALF`
// is the outer edge of the hex's own outline, `HEX_GAP - OUTLINE_HALF` the inner
// edge of the neighbour's. The rim of the grid is the one place the outer end
// has no neighbour over it, and half a pixel of extra band there goes unnoticed.
const BAND_START = OUTLINE_HALF - OVERLAP;
const BAND_END = HEX_GAP - OUTLINE_HALF + OVERLAP;

const BAND_WIDTH = BAND_END - BAND_START;
// `hexRingPoints` measures its inset inward, and the band starts outside the hex
// outline, so the inset it wants is the negative of where the band starts.
const BAND_POINTS = hexRingPoints(BAND_WIDTH, -BAND_START);

// World-space content for `HexCanvas`: the layer never sees the pan/zoom
// transform, it just draws the grid at its own coordinates. `children` land on
// top of the terrain, which is where a page puts its own units.
function HexGridLayer({ children }: { children?: ReactNode }) {
  useSignals();

  const selected = selectedKey.value;
  // The select state wins on the cell that is both, so the hover band and the
  // hover outline are skipped there rather than drawn and then covered.
  const hovered = hoveredKey.value === selected ? null : hoveredKey.value;

  return (
    <>
      {/* Both bands come before every hex, so each one is trimmed by the hexes
          around it instead of running over them. The select band is drawn second
          and wins in the gap the two states share. `key` restarts the tick with
          the outline it runs alongside: without it React keeps the element as
          the selection moves, and the band would carry on out of step with the
          new cell's outline. */}
      <Band cellKey={hovered} className={styles.hoverLine} />
      <Band cellKey={selected} className={styles.selectedLine} key={selected} />
      {grid.cells.map((cell) => (
        <Hex key={cell.key} cell={cell} stateClass={stateClass(cell.key, hovered, selected)} />
      ))}
      {children}
    </>
  );
}

// What the hex's own outline is painted with. Empty for a cell in neither state,
// which leaves `.hex` to colour it.
function stateClass(key: string, hovered: string | null, selected: string | null): string {
  if (key === selected) {
    return styles.selectedLine;
  }
  if (key === hovered) {
    return styles.hoverLine;
  }
  return "";
}

function Hex({ cell, stateClass }: { cell: HexCell; stateClass: string }) {
  return (
    <polygon
      className={`${styles.hex} ${styles[terrainOf(cell.key)]} ${stateClass}`}
      data-cell-key={cell.key}
      points={POINTS}
      transform={translate(cell)}
    />
  );
}

function Band({ cellKey, className }: { cellKey: string | null; className: string }) {
  const cell = cellKey === null ? null : cellOf(cellKey);
  if (cell === null) {
    return null;
  }

  return (
    <polygon
      className={`${styles.band} ${className}`}
      points={BAND_POINTS}
      strokeWidth={BAND_WIDTH}
      transform={translate(cell)}
    />
  );
}

function translate(cell: HexCell): string {
  return `translate(${cell.x.toFixed(2)} ${cell.y.toFixed(2)})`;
}

export { HexGridLayer };
