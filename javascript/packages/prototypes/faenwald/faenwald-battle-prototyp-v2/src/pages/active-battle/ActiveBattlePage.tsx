import { Button, Tooltip } from "@hw/faenwald-uikit";
import { useSignals } from "@preact/signals-react/runtime";
import { HexCanvas } from "../../hex/HexCanvas";
import { HexGridLayer } from "../../hex/HexGridLayer";
import { HexInfoPanel } from "../../hex/HexInfoPanel";
import { ChatPanel } from "../../session/ChatPanel";
import {
  activeUnit,
  battleUnitAt,
  battleUnits,
  cancelActions,
  cancelRotate,
  endTurn,
  hoverFacing,
  localArmy,
  localTurn,
  moveUnit,
  movingUnitId,
  previewUnit,
  rotateCellKey,
  rotateUnit,
  rotatingUnitId,
  selectUnit,
  selectedUnit,
  toggleMove,
  toggleRotate,
  turnQueue,
  unitIdAt,
  type BattleUnit,
} from "../../state/battle-state";
import { grid, hoverCell, selectCell } from "../../state/grid-state";
import { players } from "../../state/session-state";
import { InfoIcon } from "../../ui/icons";
import { UNIT_AVATARS } from "../../units/unit-avatars";
import { UnitActionsPanel } from "../../units/UnitActionsPanel";
import { UnitLayer } from "../../units/UnitLayer";
import styles from "./active-battle-page.module.css";

const ARMY_HINT = "Click a unit to find it on the board";

const TURN_ORDER_HINT = "Turn order. The leftmost unit is the one to move";

function ActiveBattlePage() {
  useSignals();

  // The unit the actions panel belongs to: the one whose turn it is, and only
  // while that turn is the local player's. Every other unit can still be
  // selected and read off the info panel, but it takes no orders — the enemy
  // army is watched, not played.
  const selected = selectedUnit.value;
  const commanded =
    localTurn.value && selected !== null && selected.id === activeUnit.value.id ? selected : null;

  return (
    <div className={styles.page}>
      <ArmyPanel />

      <div className={styles.center}>
        <div className={styles.canvas}>
          <HexCanvas onCellClick={onCellClick} onCellHover={hoverCell} world={grid.bounds}>
            <HexGridLayer>
              <UnitLayer
                onFacingHover={hoverFacing}
                onFacingPick={rotateUnit}
                preview={previewUnit.value}
                rotateCellKey={rotateCellKey.value}
                units={battleUnits.value}
              />
            </HexGridLayer>
          </HexCanvas>
          {commanded === null ? null : (
            <UnitActionsPanel
              moving={movingUnitId.value === commanded.id}
              onCancel={cancelActions}
              onMove={toggleMove}
              onRotate={toggleRotate}
              rotating={rotatingUnitId.value === commanded.id}
              unit={commanded}
            />
          )}
          <HexInfoPanel unitAt={battleUnitAt} />
        </div>

        <TurnOrderBar />
      </div>

      <div className={styles.right}>
        <PlayersPanel />
        <ChatPanel />
      </div>
    </div>
  );
}

// The same three readings the disposition page gives a hex click, minus the
// placement: every unit is already on the board. An armed move sends its unit
// to the hex — the selection is left to `moveUnit`, which follows the unit.
// Otherwise a hex with a unit on it selects that unit, and an empty one is
// dropped so the panels stay put while the pointer wanders the board.
function onCellClick(key: string): void {
  if (movingUnitId.value !== null) {
    moveUnit(key);
    return;
  }

  // A click that lands on a hex missed the handles, so it is not a rotation.
  // The handles take their own clicks and never reach this.
  cancelRotate();

  if (unitIdAt(key) === null) {
    return;
  }

  selectCell(key);
}

// The local player's army, and the button that hands the round on. The other
// side is on the board and in the turn order, but never in here.
function ArmyPanel() {
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
                {ARMY_HINT}
                <Tooltip.Arrow />
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>

      <div className={styles.roster}>
        {localArmy.map((unit) => (
          <ArmyRow key={unit.id} unit={unit} />
        ))}
      </div>

      {/* Nothing drives the other army yet, so the button hands its turn on
          too — a disabled one would leave the round stuck on the enemy. The
          label says which turn is being ended. */}
      <div className={styles.turnBar}>
        <Button.Root
          className={styles.turnButton}
          onClick={endTurn}
          variant={localTurn.value ? "primary" : "secondary"}
        >
          {localTurn.value ? "End turn" : "Skip enemy turn"}
        </Button.Root>
      </div>
    </aside>
  );
}

function ArmyRow({ unit }: { unit: BattleUnit }) {
  useSignals();

  const acting = activeUnit.value.id === unit.id;
  const className = [styles.unit, acting ? styles.unitActive : ""]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <button className={className} onClick={() => selectUnit(unit.id)} type="button">
      <img alt="" className={styles.unitAvatar} src={UNIT_AVATARS[unit.code]} />
      <span className={styles.unitBody}>
        <span className={styles.unitName}>
          {unit.title}
          {acting ? <span className={styles.unitBadge}>ход</span> : null}
        </span>
        <span className={styles.unitStats}>
          {unit.stats.health} ❤️ {unit.stats.attack} ⚔️ {unit.stats.morale} 🎺
        </span>
      </span>
    </button>
  );
}

// The round, left to right, with the unit to move at the head of it. The frame
// around a card says which army the unit belongs to; the head of the queue is
// picked out in the same gold the board selects a hex with.
function TurnOrderBar() {
  useSignals();

  return (
    <div className={styles.turnOrder}>
      <Tooltip.Root>
        <Tooltip.Trigger className={styles.infoTrigger}>
          <InfoIcon />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner>
            <Tooltip.Popup>
              {TURN_ORDER_HINT}
              <Tooltip.Arrow />
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>

      <div className={styles.turnCards}>
        {turnQueue.value.map((unit, index) => (
          <TurnCard acting={index === 0} key={unit.id} unit={unit} />
        ))}
      </div>
    </div>
  );
}

function TurnCard({ acting, unit }: { acting: boolean; unit: BattleUnit }) {
  const className = [styles.turnCard, styles[unit.side], acting ? styles.turnCardActive : ""]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <button
      className={className}
      onClick={() => selectUnit(unit.id)}
      title={unit.title}
      type="button"
    >
      <img alt={unit.title} className={styles.turnAvatar} src={UNIT_AVATARS[unit.code]} />
      {/* Four portraits stand in for seven units, so the code is what tells two
          cards of the same type apart. */}
      <span className={styles.turnCode}>{unit.code}</span>
    </button>
  );
}

// Whose turn it is, rather than who is ready: this page opens after both sides
// have finished placing.
function PlayersPanel() {
  useSignals();

  const localMoving = localTurn.value;

  return (
    <section className={styles.panel}>
      <ul className={styles.players}>
        {players.map((player) => {
          const moving = player.isLocal === localMoving;
          return (
            <li className={styles.player} key={player.id}>
              <span>{player.name}</span>
              <span
                className={moving ? `${styles.playerState} ${styles.playerMoving}` : styles.playerState}
              >
                {moving ? "to move" : "waiting"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export { ActiveBattlePage };
