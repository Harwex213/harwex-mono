import { useSignals } from "@preact/signals-react/runtime";
import { hoveredCell, selectedCell, terrainOf, type Terrain } from "../state/grid-state";
import type { Unit } from "../state/units-state";
import { InfoPanel } from "../ui/InfoPanel";
import type { HexCell } from "./hex-layout";

const TERRAIN_LABELS: Record<Terrain, string> = {
  plain: "Равнина",
  path: "Дорога",
  arcane: "Поселение",
  hills: "Холм",
  crag: "Гора",
};

const EMPTY_LABEL = "—";

// Reads the hex, not the panel: `InfoPanel` handles the looks, this decides what
// goes in it. A unit takes the whole panel over, because its name and stats say
// more about the hex than the ground under it.
//
// Who stands on a hex is the page's business — one page draws a fixed roster,
// another whatever the player has placed — so the lookup arrives as a prop.
function HexInfoPanel({ unitAt }: { unitAt: (key: string) => Unit | null }) {
  useSignals();

  // The hex under the pointer wins, and the selection is what the panel falls
  // back to once the pointer leaves the canvas.
  const cell = hoveredCell.value ?? selectedCell.value;
  const unit = cell === null ? null : unitAt(cell.key);

  return (
    <InfoPanel.Root>
      <InfoPanel.Title>{titleFor(cell, unit)}</InfoPanel.Title>
      {unit === null ? null : (
        <InfoPanel.Row>
          <span>{unit.stats.health} ❤️</span>
          <span>{unit.stats.attack} ⚔️</span>
          <span>{unit.stats.morale} 📯</span>
        </InfoPanel.Row>
      )}
    </InfoPanel.Root>
  );
}

function titleFor(cell: HexCell | null, unit: Unit | null): string {
  if (unit !== null) {
    return unit.name;
  }
  if (cell === null) {
    return EMPTY_LABEL;
  }
  return TERRAIN_LABELS[terrainOf(cell.key)];
}

export { HexInfoPanel };
