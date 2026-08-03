import { AlertDialog, Button, Drawer, Tooltip } from "@hw/faenwald-uikit";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { AttackTargetLayer } from "../../hex/AttackTargetLayer";
import { HexCanvas } from "../../hex/HexCanvas";
import { HexGridLayer } from "../../hex/HexGridLayer";
import { HexInfoPanel } from "../../hex/HexInfoPanel";
import { MoveTargetLayer } from "../../hex/MoveTargetLayer";
import { ChatPanel } from "../../session/ChatPanel";
import {
  ACCELERATE_MORALE_COST,
  PUNCH_MS,
  STEP_MS,
  accelerateUnit,
  activeUnit,
  attackFromKey,
  attackTargets,
  attackUnit,
  attackingUnitId,
  battleUnitAt,
  battleUnits,
  canAccelerate,
  canAttack,
  cancelActions,
  cancelAttack,
  cancelRotate,
  endTurn,
  findUnit,
  hoverAttackTarget,
  hoverFacing,
  hoveredTargetId,
  localArmy,
  localTurn,
  movement,
  moveTargets,
  moveUnit,
  movesLeftOf,
  movesTotalOf,
  movingUnitId,
  pendingDamage,
  rotateCellKey,
  rotateUnit,
  rotatingUnitId,
  selectScenario,
  selectUnit,
  selectedUnit,
  statsOf,
  strike,
  strikeUnit,
  toggleMove,
  toggleRotate,
  turnQueue,
  unitIdAt,
  type BattleUnit,
} from "../../state/battle-state";
import { grid, hoverCell, selectCell } from "../../state/grid-state";
import { SCENARIOS, selectedScenario } from "../../state/scenario-state";
import { players } from "../../state/session-state";
import { InfoIcon } from "../../ui/icons";
import { UNIT_AVATARS } from "../../units/unit-avatars";
import { UnitActionsPanel } from "../../units/UnitActionsPanel";
import { UnitLayer } from "../../units/UnitLayer";
import styles from "./active-battle-page.module.css";

const ARMY_HINT = "Click a unit to find it on the board";

const SCENARIOS_HINT = "Сценарий задаёт готовую расстановку обеих армий на поле.";

// How long the turn order strip takes to slide one card to the left, and how
// long the new head of the queue is flashed for afterwards. The stylesheet
// reads both off the custom properties below, so the timer that ends the
// animation and the animation itself cannot drift apart.
const SLIDE_MS = 380;

const HIGHLIGHT_MS = 700;

const TURN_TIMINGS = {
  "--turn-slide": `${SLIDE_MS}ms`,
  "--turn-highlight": `${HIGHLIGHT_MS}ms`,
} as CSSProperties;

// How long a unit takes to come round to a new facing. Nothing is timed against
// the turn — the state stores the facing the unit has finished on — so the number
// is the stylesheet's alone and lives here with the other canvas timings.
const TURN_MS = 260;

// The length of every animation played out on the board, handed to the canvas the
// markers are drawn in. The state clears a blow and a step on its own timers, so
// the animation and the timer that ends it read one number between them.
const CANVAS_TIMINGS = {
  "--unit-punch": `${PUNCH_MS}ms`,
  "--unit-step": `${STEP_MS}ms`,
  "--unit-turn": `${TURN_MS}ms`,
} as CSSProperties;

function ActiveBattlePage() {
  useSignals();

  // The panel follows the selection, whichever unit that is, so any unit can be
  // read off it. Orders are another matter: only the unit to move takes them,
  // and only while the turn is the local player's. Every other unit gets the
  // same panel with its commands muted — the enemy army is watched, not played.
  const selected = selectedUnit.value;
  const commandable =
    selected !== null && localTurn.value && selected.id === activeUnit.value.id;

  // Accelerate is the one order that is asked about before it is carried out: it
  // spends morale, and morale does not come back the way an armed move does. The
  // question is asked here rather than in the panel, because the panel is the
  // same card the disposition board draws and that board has no such order.
  const [confirmingAccelerate, setConfirmingAccelerate] = useState(false);

  // While the question is on screen the board takes no orders. The card is behind
  // a modal backdrop, so the mouse cannot reach it anyway — this is what stops a
  // shortcut key from arming something behind the answer.
  const commanding = commandable && !confirmingAccelerate;

  // A question asked of a unit that is no longer taking orders is no longer a
  // question. Nothing in the prototype can hand the turn on while the dialog is
  // up, but a question left standing would open by itself the next time one is
  // asked, and that is worth a line.
  useEffect(() => {
    if (!commandable) {
      setConfirmingAccelerate(false);
    }
  }, [commandable]);

  return (
    <div className={styles.page}>
      <ArmyPanel />

      <div className={styles.center}>
        <BattleHeader />

        <div className={styles.canvas} style={CANVAS_TIMINGS}>
          <HexCanvas onCellClick={onCellClick} onCellHover={hoverCell} world={grid.bounds}>
            <HexGridLayer>
              {/* Before the markers, so a unit is never drawn under the hexes
                  its neighbour may step onto. */}
              <MoveTargetLayer targets={moveTargets.value} />
              <UnitLayer
                movement={movement.value}
                onFacingHover={hoverFacing}
                onFacingPick={rotateUnit}
                rotateCellKey={rotateCellKey.value}
                strike={strike.value}
                threatenedDamage={pendingDamage.value?.damage ?? null}
                threatenedUnitId={hoveredTargetId.value}
                units={battleUnits.value}
              />
              {/* After the markers: the arrows point at units, and a unit the
                  attack may hit takes the pointer through the hex drawn here
                  over its marker. */}
              <AttackTargetLayer
                fromKey={attackFromKey.value}
                hoveredUnitId={hoveredTargetId.value}
                onHover={hoverAttackTarget}
                onPick={strikeUnit}
                targets={attackTargets.value}
              />
            </HexGridLayer>
          </HexCanvas>
          {selected === null ? null : (
            <UnitActionsPanel
              accelerateDisabled={!canAccelerate.value}
              attacking={attackingUnitId.value === selected.id}
              canAttack={canAttack.value}
              disabled={!commanding}
              moves={{ left: movesLeftOf(selected.id), total: movesTotalOf(selected.id) }}
              moving={movingUnitId.value === selected.id}
              onAccelerate={() => setConfirmingAccelerate(true)}
              onAttack={attackUnit}
              onCancel={cancelActions}
              onFind={findUnit}
              onMove={toggleMove}
              onRotate={toggleRotate}
              rotating={rotatingUnitId.value === selected.id}
              unit={selected}
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

      {/* Portalled out of here, so it does not matter that the board is drawn in
          a box that clips what overflows it. */}
      {selected === null ? null : (
        <AccelerateDialog
          onConfirm={accelerateUnit}
          onOpenChange={setConfirmingAccelerate}
          open={confirmingAccelerate && commandable}
          unit={selected}
        />
      )}
    </div>
  );
}

// The question asked before an Accelerate order is carried out: what the order
// gives against what it costs, in the numbers the unit stands at now and the
// ones it would stand at after. A morale spent is not an armed order called off,
// so the trade is read before it is made rather than after.
function AccelerateDialog({
  onConfirm,
  onOpenChange,
  open,
  unit,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  unit: BattleUnit;
}) {
  useSignals();

  const movesLeft = movesLeftOf(unit.id);
  const morale = statsOf(unit.id).morale;

  return (
    <AlertDialog.Root onOpenChange={onOpenChange} open={open}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Viewport>
          <AlertDialog.Popup>
            <AlertDialog.Title>Accelerate {unit.title}?</AlertDialog.Title>
            <AlertDialog.Description>
              The unit is driven on past its own pace: everything it has left to spend this turn is
              doubled, and the drive is paid for in morale.
            </AlertDialog.Description>

            <dl className={styles.trade}>
              <div className={styles.tradeRow}>
                <dt className={styles.tradeLabel}>Moves left</dt>
                <dd className={styles.tradeValue}>
                  {movesLeft} <span className={styles.tradeArrow}>→</span> {movesLeft * 2}
                </dd>
              </div>
              <div className={styles.tradeRow}>
                <dt className={styles.tradeLabel}>Morale 🎺</dt>
                <dd className={styles.tradeValue}>
                  {morale} <span className={styles.tradeArrow}>→</span>{" "}
                  {Math.max(0, morale - ACCELERATE_MORALE_COST)}
                </dd>
              </div>
            </dl>

            <div className={styles.dialogActions}>
              <AlertDialog.Close>Cancel</AlertDialog.Close>
              {/* `Close` shuts the dialog itself; the order is what this adds to
                  it. Both the button and the state behind it are answered, so a
                  second Accelerate opens the question again. */}
              <AlertDialog.Close className={styles.dialogConfirm} onClick={onConfirm}>
                Accelerate
              </AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// The same three readings the disposition page gives a hex click, minus the
// placement: every unit is already on the board. An armed move sends its unit
// to the hex if the hex is one of the highlighted ones, and is called off if it
// is not — `moveUnit` decides which, and follows the unit with the selection.
// Otherwise a hex with a unit on it selects that unit, and an empty one is
// dropped so the panels stay put while the pointer wanders the board.
function onCellClick(key: string): void {
  if (movingUnitId.value !== null) {
    moveUnit(key);
    return;
  }

  // A click that lands on a hex missed every unit the attack could hit: those
  // take their own clicks and stop them there. So this is not a blow, and reads
  // as calling the attack off — the same bargain the move above makes.
  if (attackingUnitId.value !== null) {
    cancelAttack();
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

// The bar over the board: battle-wide controls, as opposed to the turn order
// bar under it, which only reports. Scenarios are the first of them.
function BattleHeader() {
  return (
    <div className={styles.header}>
      <ScenariosDrawer />
    </div>
  );
}

// The scenario the battle is fought on, and the others it could be fought on
// instead. A scenario is a predefined position — both armies, every unit on its
// opening hex — so picking one here re-deploys the board and drops the battle
// that was on it.
//
// The drawer is closed on a pick: the answer to it is the board behind it, and
// leaving the panel open would hide the position it just laid out.
function ScenariosDrawer() {
  useSignals();

  const [open, setOpen] = useState(false);
  const current = selectedScenario.value;

  return (
    <Drawer.Root onOpenChange={setOpen} open={open} swipeDirection="right">
      <Drawer.Trigger className={styles.scenariosTrigger}>
        <span className={styles.scenariosTriggerLabel}>Сценарии</span>
        <span className={styles.scenariosTriggerName}>{current.name}</span>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop />
        <Drawer.Viewport>
          <Drawer.Popup>
            <Drawer.Content>
              <Drawer.Title>Сценарии</Drawer.Title>
              <Drawer.Description>{SCENARIOS_HINT}</Drawer.Description>

              <div className={styles.scenarioList}>
                {SCENARIOS.map((scenario) => (
                  <button
                    aria-pressed={scenario.id === current.id}
                    className={styles.scenarioCard}
                    key={scenario.id}
                    onClick={() => {
                      selectScenario(scenario.id);
                      setOpen(false);
                    }}
                    type="button"
                  >
                    <span className={styles.scenarioLabel}>
                      {scenario.id === current.id ? "Текущий сценарий" : "Сценарий"}
                    </span>
                    <span className={styles.scenarioName}>{scenario.name}</span>
                    <span className={styles.scenarioSummary}>{scenario.summary}</span>
                  </button>
                ))}
              </div>

              <Drawer.Close>Закрыть</Drawer.Close>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
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
        {localArmy.value.map((unit) => (
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

  // The badge says whose turn it is; the frame says which unit the panels are
  // answering for. Two different questions, so they are drawn apart — a row is
  // clickable whether or not the unit on it can be given an order.
  const acting = activeUnit.value.id === unit.id;
  const selected = selectedUnit.value?.id === unit.id;
  const className = [styles.unit, selected ? styles.unitSelected : ""]
    .filter((part) => part !== "")
    .join(" ");

  // What the battle has left the unit with, not what the scenario opened it on.
  const stats = statsOf(unit.id);

  return (
    <button className={className} onClick={() => selectUnit(unit.id)} type="button">
      <img alt="" className={styles.unitAvatar} src={UNIT_AVATARS[unit.code]} />
      <span className={styles.unitBody}>
        <span className={styles.unitName}>
          {unit.title}
          {acting ? <span className={styles.unitBadge}>ход</span> : null}
        </span>
        <span className={styles.unitStats}>
          {stats.health} ❤️ {stats.attack} ⚔️ {stats.morale} 🎺
        </span>
      </span>
    </button>
  );
}

// The round, left to right, with the unit to move at the head of it. The frame
// around a card says which army the unit belongs to; the head of the queue is
// picked out in the same gold the board selects a hex with.
//
// Ending a turn rotates the queue by one, and the bar plays that out instead of
// jumping to it: the unit that has just moved leaves the head slot upwards, the
// strip slides one card to the left, the same unit comes back in from below at
// the tail, and the new head is flashed.
function TurnOrderBar() {
  useSignals();

  const queue = turnQueue.value;
  const head = queue[0];

  // The unit that has just moved, drawn one last time in the slot it is
  // leaving. The queue already carries it as the tail card, so the card going
  // out and the card coming in have to be two elements.
  const [leaving, setLeaving] = useState<BattleUnit | null>(null);

  // "start" pins every card where the round before it left them; "run" is the
  // same strip a card further along, and the transitions carry it there. The
  // bar sits in "idle" between turns, with nothing animating.
  const [phase, setPhase] = useState<"idle" | "start" | "run">("idle");

  const previousHead = useRef(head);

  const trackRef = useRef<HTMLDivElement>(null);

  // Before paint, not after. The queue rotates the moment the turn ends, so the
  // render that brings the new order in has the strip sitting at the far end of
  // the animation already. Pinning it back has to land in that same frame — a
  // passive effect would let the finished strip be painted first, and the turn
  // would read as a jump forwards, a jump back, and only then the slide.
  useLayoutEffect(() => {
    const previous = previousHead.current;
    previousHead.current = head;

    // The first render has nothing to play out, and neither does a re-render
    // the queue slept through.
    if (previous.id === head.id) {
      return;
    }

    setLeaving(previous);
    setPhase("start");
  }, [head]);

  // A transition needs a value to start from, so the pinned styles have to be
  // a state the browser has already worked out. Reading the layout back forces
  // that, and the switch to "run" a line later is then a change from it rather
  // than the value the strip opens with. An animation frame would do the same
  // job, but a background tab is handed none, and the strip would sit pinned to
  // the round before until the tab came back.
  useLayoutEffect(() => {
    if (phase !== "start") {
      return;
    }

    void trackRef.current?.offsetWidth;
    setPhase("run");
  }, [phase]);

  // The flash outlasts the slide, so the whole animation is over one highlight
  // later. A turn ended mid-animation restarts the run from "start" above, and
  // this timer is dropped with it.
  useEffect(() => {
    if (phase !== "run") {
      return;
    }

    const timer = window.setTimeout(() => {
      setPhase("idle");
      setLeaving(null);
    }, HIGHLIGHT_MS);

    return () => window.clearTimeout(timer);
  }, [phase]);

  return (
    <div className={styles.turnOrder} data-phase={phase} style={TURN_TIMINGS}>
      <div className={styles.turnCards}>
        <div className={styles.turnTrack} ref={trackRef}>
          {queue.map((unit, index) => (
            <TurnCard
              acting={index === 0}
              entering={index === queue.length - 1}
              key={unit.id}
              unit={unit}
            />
          ))}
        </div>

        {leaving === null ? null : <LeavingCard unit={leaving} />}
      </div>
    </div>
  );
}

function TurnCard({
  acting,
  entering,
  unit,
}: {
  acting: boolean;
  entering: boolean;
  unit: BattleUnit;
}) {
  const className = [
    styles.turnCard,
    styles[unit.side],
    acting ? styles.turnCardActive : "",
    entering ? styles.turnEnter : "",
  ]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <button
      className={className}
      onClick={() => selectUnit(unit.id)}
      title={unit.title}
      type="button"
    >
      <TurnCardFace unit={unit} />
    </button>
  );
}

// The card of the unit that has just moved, left over the head slot for the
// length of the animation. It is a ghost of a card that is already back in the
// strip, so it takes no clicks and answers no screen reader.
function LeavingCard({ unit }: { unit: BattleUnit }) {
  const className = [styles.turnCard, styles[unit.side], styles.turnCardActive, styles.turnLeave]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <div aria-hidden="true" className={className}>
      <TurnCardFace unit={unit} />
    </div>
  );
}

function TurnCardFace({ unit }: { unit: BattleUnit }) {
  return (
    <>
      {/* The card leaving the head slot is a new element every turn, and it is
          drawn at full strength over a slot the strip has already left. A
          portrait decoded a frame late would show as a hole there, so this one
          is decoded before the frame it belongs to goes out. */}
      <img
        alt={unit.title}
        className={styles.turnAvatar}
        decoding="sync"
        src={UNIT_AVATARS[unit.code]}
      />
      {/* Four portraits stand in for seven units, so the code is what tells two
          cards of the same type apart. */}
      <span className={styles.turnCode}>{unit.code}</span>
    </>
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
