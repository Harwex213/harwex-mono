import { useSignals } from "@preact/signals-react/runtime";
import type { AttackDamage } from "../state/attack-strategies";
import type { UnitModifier } from "../state/formations";
import { cellOf, hoveredCell, selectedCell, type Terrain, terrainOf } from "../state/grid-state";
import type { Unit } from "../state/units-state";
import { InfoPanel } from "../ui/InfoPanel";
import { ModifierList } from "../ui/ModifierList";
import type { HexCell } from "./hex-layout";

const TERRAIN_LABELS: Record<Terrain, string> = {
  plain: "Равнина",
  path: "Дорога",
  arcane: "Поселение",
  hills: "Предхольме",
  crag: "Холм",
};

const EMPTY_LABEL = "—";

// The hex an armed attack is pointed at, and what the blow would take off the
// unit standing on it. The board is the one that knows this, so it arrives as a
// prop the way the unit lookup does — a page with no attacks on it passes none.
type HexThreat = {
  key: string;
  damage: AttackDamage;
};

// Reads the hex, not the panel: `InfoPanel` handles the looks, this decides what
// goes in it. A unit takes the whole panel over, because its name and stats say
// more about the hex than the ground under it.
//
// Who stands on a hex is the page's business — one page draws a fixed roster,
// another whatever the player has placed — so the lookup arrives as a prop.
function HexInfoPanel({
  modifiersOf,
  threat = null,
  unitAt,
}: {
  // What the unit on the hex is carrying because of where it stands. A second
  // lookup rather than something read off the unit: the marker shape is what the
  // board draws with, and a modifier is nothing the board draws on a marker.
  // Left out by a page that has no modifiers, which draws none.
  modifiersOf?: (unitId: string) => UnitModifier[];
  threat?: HexThreat | null;
  unitAt: (key: string) => Unit | null;
}) {
  useSignals();

  // The hex the attack is aimed at wins over both readings below. The pointer
  // that aimed it may be resting on the arrow reaching the target rather than on
  // the target's own hex, and the panel has to answer for the unit about to be
  // hit either way.
  //
  // Otherwise the hex under the pointer wins, and the selection is what the
  // panel falls back to once the pointer leaves the canvas.
  const aimed = threat === null ? null : cellOf(threat.key);
  const cell = aimed ?? hoveredCell.value ?? selectedCell.value;
  const unit = cell === null ? null : unitAt(cell.key);

  // A blow is only read against the unit it is aimed at, so nothing is projected
  // onto the unit the panel has fallen back to.
  const damage = cell !== null && cell === aimed ? threat?.damage ?? null : null;

  return (
    <InfoPanel.Root>
      <InfoPanel.Title>{titleFor(cell, unit)}</InfoPanel.Title>
      {unit === null ? null : (
        <InfoPanel.Row>
          <StatValue icon="❤️" loss={damage?.health ?? 0} value={unit.stats.health} />
          <span>{unit.stats.attack} ⚔️</span>
          <StatValue icon="📯" loss={damage?.morale ?? 0} value={unit.stats.morale} />
        </InfoPanel.Row>
      )}
      {/* Under the stats, the same order the card on the other side of the board
          lists them in — so a modifier is found in the same place whichever panel
          the unit is being read off. */}
      {unit === null || modifiersOf === undefined ? null : (
        <ModifierList modifiers={modifiersOf(unit.id)} />
      )}
    </InfoPanel.Root>
  );
}

// One stat, as it stands or as a blow would leave it. A blow that takes nothing
// off this stat is not shown as a change: `100 → 100` says a number is about to
// move when it is not.
function StatValue({ icon, loss, value }: { icon: string; loss: number; value: number }) {
  if (loss === 0) {
    return (
      <span>
        {value} {icon}
      </span>
    );
  }

  return (
    <span>
      <InfoPanel.Projection from={value} to={Math.max(0, value - loss)} /> {icon}
    </span>
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
export type { HexThreat };
