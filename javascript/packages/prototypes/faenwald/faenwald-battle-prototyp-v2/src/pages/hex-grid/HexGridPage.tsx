import { Button } from "@hw/faenwald-uikit";
import { useSignals } from "@preact/signals-react/runtime";
import { useRef } from "react";
import { HexCanvas, type HexCanvasHandle } from "../../hex/HexCanvas";
import { HexGridLayer } from "../../hex/HexGridLayer";
import { COLS, ROWS, grid, selectCell, selectedCell, terrainOf } from "../../state/grid-state";
import styles from "./hex-grid-page.module.css";

function HexGridPage() {
  useSignals();

  const canvasRef = useRef<HexCanvasHandle>(null);
  const cell = selectedCell.value;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.status}>
          {cell === null
            ? `${COLS} × ${ROWS} hexes — click one to select it`
            : `col ${cell.col}, row ${cell.row} — ${terrainOf(cell.key)}`}
        </span>
        <span className={styles.hint}>Drag to pan, scroll to zoom</span>
        <Button.Root size="sm" variant="secondary" onClick={() => canvasRef.current?.fit()}>
          Fit
        </Button.Root>
      </div>

      <div className={styles.canvas}>
        <HexCanvas handleRef={canvasRef} onCellClick={selectCell} world={grid.bounds}>
          <HexGridLayer />
        </HexCanvas>
      </div>
    </div>
  );
}

export { HexGridPage };
