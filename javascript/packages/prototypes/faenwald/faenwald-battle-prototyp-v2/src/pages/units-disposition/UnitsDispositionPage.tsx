import { Button, Tooltip } from "@hw/faenwald-uikit";
import { useSignals } from "@preact/signals-react/runtime";
import { playUnitSelect } from "../../audio/sounds";
import { HexCanvas } from "../../hex/HexCanvas";
import { HexGridLayer } from "../../hex/HexGridLayer";
import { HexInfoPanel } from "../../hex/HexInfoPanel";
import { PlacementLayer } from "../../hex/PlacementLayer";
import { ChatPanel } from "../../session/ChatPanel";
import {
  cancelActions,
  cancelMove,
  cancelPick,
  cancelRotate,
  hoverFacing,
  isPlaced,
  moveUnit,
  movingUnitId,
  pickUnit,
  pickedUnitId,
  placeUnit,
  placeableCellKeys,
  placedCount,
  placedUnitAt,
  placedUnits,
  placementOf,
  previewUnit,
  ready,
  rotateCellKey,
  rotateUnit,
  rotatingUnitId,
  roster,
  selectedUnit,
  swapCellKey,
  toggleMove,
  toggleReady,
  toggleRotate,
  unitIdAt,
  type RosterUnit,
} from "../../state/disposition-state";
import { focusCell, grid, hoverCell, selectCell, selectedKey } from "../../state/grid-state";
import { players } from "../../state/session-state";
import { InfoIcon } from "../../ui/icons";
import { UnitActionsPanel } from "../../units/UnitActionsPanel";
import { UnitLayer } from "../../units/UnitLayer";
import styles from "./units-disposition-page.module.css";

const ROSTER_HINT = "Pick a unit from the list, then click a hex";

function UnitsDispositionPage() {
  useSignals();

  const unit = selectedUnit.value;

  return (
    <div className={styles.page}>
      <RosterPanel />

      <div className={styles.canvas}>
        <HexCanvas onCellClick={onCellClick} onCellHover={hoverCell} world={grid.bounds}>
          <HexGridLayer>
            {/* Under the markers, so the preview of the unit being placed is
                drawn on top of the hex it would land on. */}
            <PlacementLayer cellKeys={placeableCellKeys.value} />
            <UnitLayer
              onFacingHover={hoverFacing}
              onFacingPick={rotateUnit}
              preview={previewUnit.value}
              rotateCellKey={rotateCellKey.value}
              swapCellKey={swapCellKey.value}
              units={placedUnits.value}
            />
          </HexGridLayer>
        </HexCanvas>
        {unit === null ? null : (
          <UnitActionsPanel
            moving={movingUnitId.value === unit.id}
            onCancel={cancelActions}
            onMove={toggleMove}
            onRotate={toggleRotate}
            rotating={rotatingUnitId.value === unit.id}
            unit={unit}
          />
        )}
        <HexInfoPanel unitAt={placedUnitAt} />
      </div>

      <div className={styles.right}>
        <PlayersPanel />
        <ChatPanel />
      </div>
    </div>
  );
}

// One click, three readings. An armed move sends its unit to the hex — the
// selection is left to `moveUnit`, which follows the unit. An armed roster unit
// is dropped on the hex. A click on a unit with nothing armed selects it, which
// is what opens the actions panel.
function onCellClick(key: string): void {
  if (movingUnitId.value !== null) {
    moveUnit(key);
    return;
  }

  // A click that lands on a hex missed the handles, so it is not a rotation. The
  // handles take their own clicks and never reach this.
  cancelRotate();

  if (pickedUnitId.value !== null) {
    placeUnit(key);
  }

  // Only a hex with a unit on it can be selected: an empty one has nothing to
  // show in the actions panel. A click on one is dropped rather than clearing the
  // selection, so the panel stays while the pointer wanders the board. Read after
  // the placement above, so the hex a unit just landed on selects itself.
  if (unitIdAt(key) === null) {
    return;
  }

  // The click landed on a unit already on the board, so a unit still armed from
  // the roster was aimed at some other hex. It is disarmed for the same reason
  // arming one clears the selection: the panel and the roster must not talk about
  // two different units.
  cancelPick();
  selectCell(key);

  // The sound answers the selection, not the click. `selectCell` toggles, so a
  // second click on the selected unit lets it go, and a unit being let go has no
  // selection to answer.
  if (selectedKey.value === key) {
    playUnitSelect();
  }
}

function RosterPanel() {
  useSignals();

  return (
    <aside className={styles.left}>
      <div className={styles.leftHeader}>
        <h2 className={styles.leftTitle}>Ваши войска</h2>
        <Tooltip.Root>
          <Tooltip.Trigger className={styles.infoTrigger}>
            <InfoIcon />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner>
              <Tooltip.Popup>
                {ROSTER_HINT}
                <Tooltip.Arrow />
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>

      <div className={styles.roster}>
        {roster.map((unit) => (
          <RosterRow key={unit.id} unit={unit} />
        ))}
      </div>

      <div className={styles.readyBar}>
        <Button.Root
          className={styles.readyButton}
          disabled={placedCount.value === 0}
          onClick={toggleReady}
          variant={ready.value ? "secondary" : "primary"}
        >
          {ready.value ? "Not ready" : "Ready"}
        </Button.Root>
      </div>
    </aside>
  );
}

function RosterRow({ unit }: { unit: RosterUnit }) {
  useSignals();

  const placed = isPlaced(unit.id);
  const picked = pickedUnitId.value === unit.id;
  const className = [styles.unit, picked ? styles.unitPicked : "", placed ? styles.unitPlaced : ""]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <button className={className} onClick={() => onRosterClick(unit.id)} type="button">
      <span className={styles.unitName}>
        {unit.title}
        {placed ? <span className={styles.unitBadge}>on grid</span> : null}
      </span>
      <span className={styles.unitStats}>
        {unit.stats.health} ❤️ {unit.stats.attack} ⚔️ {unit.stats.morale} 🎺
      </span>
    </button>
  );
}

// A placed unit has nothing to arm, so its row selects it on the canvas
// instead — the same state a click on its hex leaves behind.
function onRosterClick(unitId: string): void {
  const placement = placementOf(unitId);
  if (placement !== null) {
    // A pick, move or rotation armed on some other unit was aimed at the board,
    // and the roster row is not the board. Selecting a different unit while one
    // stayed armed would leave the panel and the canvas talking about two
    // different units.
    cancelPick();
    cancelMove();
    cancelRotate();
    focusCell(placement);
    playUnitSelect();
    return;
  }

  pickUnit(unitId);
}

function PlayersPanel() {
  useSignals();

  return (
    <section className={styles.panel}>
      <ul className={styles.players}>
        {players.map((player) => {
          const isReady = player.isLocal && ready.value;
          return (
            <li className={styles.player} key={player.id}>
              <span>{player.name}</span>
              <span className={isReady ? `${styles.playerState} ${styles.playerReady}` : styles.playerState}>
                {isReady ? "ready" : "placing"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export { UnitsDispositionPage };
