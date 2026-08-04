import { AlertDialog, Drawer, Tooltip } from "@hw/faenwald-uikit";
import { useSignals } from "@preact/signals-react/runtime";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { playUnitSelect } from "../../audio/sounds";
import { AttackTargetLayer } from "../../hex/AttackTargetLayer";
import { CanopyConeLayer } from "../../hex/CanopyConeLayer";
import { FormationLayer } from "../../hex/FormationLayer";
import { HexCanvas, type HexCanvasHandle } from "../../hex/HexCanvas";
import { HexGridLayer } from "../../hex/HexGridLayer";
import { HexInfoPanel } from "../../hex/HexInfoPanel";
import { MoveTargetLayer } from "../../hex/MoveTargetLayer";
import { ProjectileLayer } from "../../hex/ProjectileLayer";
import { ChatPanel } from "../../session/ChatPanel";
import {
  ACCELERATE_MORALE_COST,
  PUNCH_IMPACT_MS,
  PUNCH_MS,
  SHOT_MS,
  STEP_MS,
  accelerateUnit,
  activeUnit,
  armedAttack,
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
  canopyConeKeys,
  endTurn,
  formationLinks,
  hoverAttackTarget,
  hoverFacing,
  hoveredTargetId,
  hoveredTargetKey,
  localArmy,
  localTurn,
  modifiersOf,
  movement,
  moveTargets,
  moveUnit,
  movesLeftOf,
  movesTotalOf,
  movingUnitId,
  opportunityAttacker,
  opportunityAttackerId,
  opportunityOpen,
  opportunityUnits,
  opportunityVictimId,
  pendingDamage,
  rotateCellKey,
  rotateUnit,
  rotatingUnitId,
  roundBreakOffset,
  roundNumber,
  selectScenario,
  selectUnit,
  selectedAttack,
  selectedUnit,
  setCanopyCone,
  showCanopyCone,
  statsOf,
  strike,
  strikeUnit,
  toggleMove,
  toggleRotate,
  turnQueue,
  unitIdAt,
  type BattleUnit,
} from "../../state/battle-state";
import { grid, hoverCell, selectCell, selectedCell, selectedKey } from "../../state/grid-state";
import { SCENARIOS, selectedScenario } from "../../state/scenario-state";
import { players } from "../../state/session-state";
import { InfoIcon } from "../../ui/icons";
import { isInOverlay, isTyping } from "../../ui/keyboard";
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

// How long the sweep across the End turn button takes to cross it. The same
// length as the slide above, so the button finishes filling as the turn order
// strip settles on the unit that is now up: one turn handed on, told twice.
const FILL_TIMING = {
  "--turn-fill": `${SLIDE_MS}ms`,
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
  // How far into a lunge the blow lands. A shot has already travelled by the time
  // it comes down, so the unit under it is handed this much of the reaction as a
  // negative delay — see `.landed` in `unit.module.css`.
  "--unit-punch-impact": `${PUNCH_IMPACT_MS}ms`,
  "--unit-shot": `${SHOT_MS}ms`,
  "--unit-step": `${STEP_MS}ms`,
  "--unit-turn": `${TURN_MS}ms`,
} as CSSProperties;

function ActiveBattlePage() {
  useSignals();

  // The panel follows the selection, whichever unit that is, so any unit can be
  // read off it. Orders are another matter: only the unit to move takes them.
  // The unit's side does not come into it — nothing drives the enemy army, so
  // the local player plays both sides. Every other unit gets the same panel
  // with its commands muted. An open Оппортун takes the board away on top of
  // that: the swing is answered first, and the only thing the card is good for
  // while the window stands is reading the unit that is about to be hit.
  const selected = selectedUnit.value;
  const commandable =
    selected !== null && !opportunityOpen.value && selected.id === activeUnit.value.id;

  // Accelerate is the one order that is asked about before it is carried out: it
  // spends morale, and morale does not come back the way an armed move does. The
  // question is asked here rather than in the panel, because the panel is the
  // same card the disposition board draws and that board has no such order.
  const [confirmingAccelerate, setConfirmingAccelerate] = useState(false);

  // While the question is on screen the board takes no orders. The card is behind
  // a modal backdrop, so the mouse cannot reach it anyway — this is what stops a
  // shortcut key from arming something behind the answer.
  const commanding = commandable && !confirmingAccelerate;

  // What the info panel reads the target's stats against while an attack is
  // armed and the pointer rests on somebody it may hit. Both halves come off the
  // same hover, so they are either both there or both gone — the hex says which
  // unit the panel answers for, the damage what the blow would leave it at.
  const damage = pendingDamage.value;
  const threatKey = hoveredTargetKey.value;
  const threat =
    damage === null || threatKey === null ? null : { damage: damage.damage, key: threatKey };

  // The cone switch belongs to a shooter and to nobody else: a unit that fights
  // by hand has no cone to draw, and is handed no handler to draw one with — which
  // is what keeps the switch off its card.
  const coneToggle = selectedAttack.value?.kind === "canopy" ? setCanopyCone : undefined;

  // Find is the one order on the card the board never hears about: it moves the
  // view rather than the unit. That makes it the page's own — the canvas owns
  // the pan and zoom, and `battle-state` has no way to reach them.
  const canvasRef = useRef<HexCanvasHandle>(null);

  // The unit is found by the hex it stands on, so a unit mid-step is followed to
  // the hex it is walking to rather than the one it has left.
  const findSelected = useCallback(() => {
    const cell = selectedCell.value;
    if (cell === null) {
      return;
    }

    canvasRef.current?.centerOn(cell.x, cell.y);
  }, []);

  // A roster row selects the unit and finds it in one go: the row says nothing
  // about where the unit stands, so picking one off the list is the player
  // asking where it is. The selection lands before the view is moved, so the
  // hex the view travels to is the one the row has just selected.
  //
  // The board's own controls are left alone. A click on a hex is already aimed
  // at a unit in view, and a turn order card is read rather than looked for.
  const selectFromRoster = useCallback(
    (unitId: string) => {
      onUnitCardClick(unitId);
      findSelected();
    },
    [findSelected],
  );

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
      <ArmyPanel onUnitClick={selectFromRoster} />

      <div className={styles.center}>
        <BattleHeader />

        <div className={styles.canvas} style={CANVAS_TIMINGS}>
          <HexCanvas
            handleRef={canvasRef}
            onCellClick={onCellClick}
            onCellHover={hoverCell}
            world={grid.bounds}
          >
            {/* The hex of the target under the pointer wears the attack colour
                in place of the hover one, so the board answers a pointer resting
                on a target with one ring rather than two. */}
            <HexGridLayer attackKey={hoveredTargetKey.value}>
              {/* Under everything: a border around a whole cone of hexes, which
                  says where a shot could come down rather than what the board is
                  waiting for. An order armed on one of those hexes has to be read
                  over the top of it. */}
              <CanopyConeLayer cellKeys={canopyConeKeys.value} />
              {/* Also under the markers, and in the gap between two of them: a
                  chain says how a pair of spearmen is standing, which is worth
                  less than anything an order has put on the board. */}
              <FormationLayer links={formationLinks.value} />
              {/* Before the markers, so a unit is never drawn under the hexes
                  its neighbour may step onto. */}
              <MoveTargetLayer targets={moveTargets.value} />
              <UnitLayer
                movement={movement.value}
                onFacingHover={hoverFacing}
                onFacingPick={rotateUnit}
                opportunityAttackerId={opportunityAttackerId.value}
                opportunityVictimId={opportunityVictimId.value}
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
                kind={armedAttack.value?.kind ?? "melee"}
                onHover={hoverAttackTarget}
                onPick={strikeUnit}
                targets={attackTargets.value}
              />
              {/* Last of all: an arrow in the air is over every unit it flies
                  across, and over the cues drawn on their hexes. */}
              <ProjectileLayer strike={strike.value} />
            </HexGridLayer>
          </HexCanvas>
          {selected === null ? null : (
            <UnitActionsPanel
              accelerateDisabled={!canAccelerate.value}
              attackLabel={selectedAttack.value?.label}
              attacking={attackingUnitId.value === selected.id}
              canAttack={canAttack.value}
              coneShown={showCanopyCone.value}
              disabled={!commanding}
              modifiers={modifiersOf(selected.id)}
              moves={{ left: movesLeftOf(selected.id), total: movesTotalOf(selected.id) }}
              moving={movingUnitId.value === selected.id}
              onAccelerate={() => setConfirmingAccelerate(true)}
              onAttack={attackUnit}
              onCancel={cancelActions}
              onConeToggle={coneToggle}
              onFind={findSelected}
              onMove={toggleMove}
              onRotate={toggleRotate}
              rotating={rotatingUnitId.value === selected.id}
              unit={selected}
            />
          )}
          <HexInfoPanel modifiersOf={modifiersOf} threat={threat} unitAt={battleUnitAt} />
          <OpportunityBanner />
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
// The panel that says the board has been taken over. It stands over the top of
// the board for as long as an Оппортун is open, names the enemy holding the
// swing, and says the two ways the swing can end — because neither of them is
// an order the local player gives.
//
// Nothing at all while no window is open: the board is the player's, and a
// panel saying so would be in the way of it.
function OpportunityBanner() {
  useSignals();

  const attacker = opportunityAttacker.value;
  if (attacker === null) {
    return null;
  }

  return (
    <div className={styles.opportunityBanner} role="status">
      <span className={styles.opportunityTitle}>
        Оппортун! Отряд в красной рамке под ударом
      </span>
      <span className={styles.opportunityHint}>
        <strong>{attacker.title}</strong> бьёт по отряду в красной рамке или отказывается от
        удара.
      </span>
    </div>
  );
}

function onCellClick(key: string): void {
  // The board belongs to the enemy holding the swing while an Оппортун is open.
  // A click that lands on a hex missed the unit the swing may be taken at —
  // those take their own clicks — so it is not the swing, and there is nothing
  // else on the board for a click to mean.
  if (opportunityOpen.value) {
    return;
  }

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

  // The sound answers the selection, not the click. `selectCell` toggles, so a
  // second click on the selected unit lets it go, and a unit being let go has no
  // selection to answer.
  if (selectedKey.value === key) {
    playUnitSelect();
  }
}

// Selects a unit from a control outside the canvas — an army roster card or a
// turn order card. The sound is played here rather than inside `selectUnit`: the
// same call hands the round on at the end of a turn, and that selection is the
// board's own rather than a click on a unit.
function onUnitCardClick(unitId: string): void {
  selectUnit(unitId);
  playUnitSelect();
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
//
// What a row does with the unit on it is the page's to say — a row selects the
// unit and brings it into view, and the view is the canvas's rather than the
// state's — so the handler comes in from outside.
function ArmyPanel({ onUnitClick }: { onUnitClick: (unitId: string) => void }) {
  useSignals();

  return (
    <aside className={styles.left}>
      <div className={styles.leftHeader}>
        <h2 className={styles.leftTitle}>Ваши войска</h2>
        <Tooltip.Root>
          {/* No wait before the hint is shown. The trigger is an ⓘ and stands
              for nothing but the hint behind it, so a pointer resting on it has
              already asked the question the delay is there to wait for. */}
          <Tooltip.Trigger className={styles.infoTrigger} delay={0}>
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
          <ArmyRow key={unit.id} onClick={onUnitClick} unit={unit} />
        ))}
      </div>

      {/* The button ends whichever turn is being played. Nothing drives the
          other army, so the enemy's turn is the player's to play and to end
          too — the label says whose turn it is.

          With an Оппортун open the button belongs to the swing instead:
          pressing it is the unit holding the swing letting it go. The same one
          button, because the same key has always stood for "I am done", and
          whoever the board is waiting on is who it is done for. */}
      <div className={styles.turnBar}>
        <TurnButton />
      </div>
    </aside>
  );
}

// The button that hands the round on, and the key that stands for it. Both mean
// "I am done", so both go through one handler here — and both are answered the
// same way: a bar sweeps the button from its left edge to its right one, so a
// press reads as a turn closed rather than as a click that may or may not have
// landed.
//
// The button is the page's own rather than the uikit one: the sweep is drawn
// inside it, under the label, and a button with no layer to draw in has nowhere
// to put it.
function TurnButton() {
  useSignals();

  // Which sweep is running, rather than whether one is. The bar is drawn keyed
  // on this number, so a press during a sweep starts a new one from the left
  // edge — the same element under the same class would leave CSS running the
  // animation once, and the second press would go unanswered.
  const [sweep, setSweep] = useState(0);

  // A press is not always a turn ended. With an Оппортун open it gives the swing
  // up, and a swing provoked by the closing turn holds the turn open instead of
  // handing it on — `endTurn` reads the board and picks between the three. So
  // the sweep answers the unit that is up having changed, which is the one thing
  // only a turn handed on does.
  const handOn = useCallback(() => {
    const acting = activeUnit.value.id;

    endTurn();

    if (activeUnit.value.id !== acting) {
      setSweep((previous) => previous + 1);
    }
  }, []);

  // Space hands the round on, the way the button does. The default is taken over
  // rather than left alone: space on a focused button clicks it, and on the page
  // it scrolls, so both would fire alongside the turn ending.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== " ") {
        return;
      }

      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTyping(event.target) ||
        isInOverlay(event.target)
      ) {
        return;
      }

      event.preventDefault();

      // A held key repeats. One press ends one turn.
      if (event.repeat) {
        return;
      }

      handOn();
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handOn]);

  // The bar is taken off once it has crossed, so the button waits for the next
  // turn as a button rather than as a filled bar. A turn ended mid-sweep bumps
  // the number above, and this timer is dropped with the sweep it belonged to.
  useEffect(() => {
    if (sweep === 0) {
      return;
    }

    const timer = window.setTimeout(() => setSweep(0), SLIDE_MS);

    return () => window.clearTimeout(timer);
  }, [sweep]);

  // While the board is waiting on a swing the button is not what the player is
  // meant to reach for — the blow is answered on the board — so it steps back
  // out of the primary colour, the way the uikit secondary button does.
  const className = [styles.turnButton, opportunityOpen.value ? styles.turnButtonQuiet : ""]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <button className={className} onClick={handOn} style={FILL_TIMING} type="button">
      {/* Under the label, which is why the label is positioned too: the bar is
          positioned and would otherwise be painted over the words it runs
          behind. */}
      {sweep === 0 ? null : <span aria-hidden="true" className={styles.turnFill} key={sweep} />}
      <span className={styles.turnLabel}>{turnButtonLabel()}</span>
    </button>
  );
}

// What the one button under the roster is for at this moment. Read during a
// render that tracks signals, so it follows the board.
function turnButtonLabel(): string {
  if (opportunityOpen.value) {
    return "Отказаться от оппортуна (Space)";
  }

  return localTurn.value ? "End turn (Space)" : "End enemy turn (Space)";
}

function ArmyRow({
  onClick,
  unit,
}: {
  onClick: (unitId: string) => void;
  unit: BattleUnit;
}) {
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
    <button className={className} onClick={() => onClick(unit.id)} type="button">
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

// A card in the turn order bar: a unit of either army, or the line the next
// round begins on.
type TurnEntry =
  | { key: string; kind: "unit"; unit: BattleUnit }
  | { key: string; kind: "round"; round: number };

// The key the round line is drawn under. Fixed rather than tied to the round it
// stands for, so the line slides along the strip with the cards around it
// instead of being thrown away and built again every turn.
const ROUND_ENTRY_KEY = "round-break";

// No Оппортун card is coming in. One value rather than a new empty set per turn,
// so the state the bar rests at is the same object it started on.
const NO_INTERRUPTS: ReadonlySet<string> = new Set();

// The round, left to right, with the unit to move at the head of it. The frame
// around a card says which army the unit belongs to; the head of the queue is
// picked out in the same gold the board selects a hex with. The round line sits
// between the last unit of this round and the first of the next, so the bar says
// how far the round has left to run as well as who is up.
//
// Ending a turn rotates the queue by one, and the bar plays that out instead of
// jumping to it: the unit that has just moved leaves the head slot upwards, the
// strip slides one card to the left, the same unit comes back in from below at
// the tail, and the new head is flashed.
//
// The last turn of a round takes the round line off the head of the strip along
// with the unit, so two cards leave at once and the strip slides two along. The
// line comes back at the tail once the new round's first unit has moved.
//
// An open Оппортун puts its own cards in front of all of that, one per enemy
// still to answer, each under the word the mechanic is named after. They are
// not part of the round and are kept out of `entries` for that reason: the
// handover above is worked out by comparing one round against the round before
// it, and a card that belongs to neither would be read as the queue rotating.
//
// A window opening is played out the same way a turn ending is, the other way
// round: the cards cut in at the front rise into the slots they have taken, and
// the round behind them slides right out of their way. The two animations never
// run together — nothing in the state both opens a window and hands the turn on.
function TurnOrderBar() {
  useSignals();

  const queue = turnQueue.value;
  const head = queue[0];
  const round = roundNumber.value;
  const breakOffset = roundBreakOffset.value;
  const interrupts = opportunityUnits.value;
  const victimId = opportunityVictimId.value;

  // The strip as cards, the round line among them. Everything behind the line
  // belongs to the round after this one, so the line carries that number.
  const entries: TurnEntry[] = [];
  queue.forEach((unit, index) => {
    if (index === breakOffset) {
      entries.push({ key: ROUND_ENTRY_KEY, kind: "round", round: round + 1 });
    }

    entries.push({ key: unit.id, kind: "unit", unit });
  });

  // The cards that have dropped off the front of the strip, drawn one last time
  // in the slots they are leaving. The unit that has just moved is already back
  // in the strip as the tail card, so the card going out and the card coming in
  // have to be two elements.
  const [leaving, setLeaving] = useState<TurnEntry[]>([]);

  // Where the cards coming in from below start: every card from this index to
  // the end of the strip is new this turn, and every card in front of it is one
  // the strip has kept. A card that has been kept is carried along by the slide
  // and by nothing else — it holds its place in the round, so the only thing
  // that has changed about it is how far along the strip it stands.
  //
  // One card comes in on an ordinary turn, and two on the turn the round line
  // comes back with the unit behind it.
  const [enteringFrom, setEnteringFrom] = useState(entries.length);

  // "start" pins every card where the round before it left them; "run" is the
  // same strip a card further along, and the transitions carry it there. The
  // bar sits in "idle" between turns, with nothing animating.
  const [phase, setPhase] = useState<"idle" | "start" | "run">("idle");

  const previousEntries = useRef(entries);

  const trackRef = useRef<HTMLDivElement>(null);

  // Before paint, not after. The queue rotates the moment the turn ends, so the
  // render that brings the new order in has the strip sitting at the far end of
  // the animation already. Pinning it back has to land in that same frame — a
  // passive effect would let the finished strip be painted first, and the turn
  // would read as a jump forwards, a jump back, and only then the slide.
  //
  // Run on every render rather than on the head alone: the strip is compared
  // against the one last painted, so a strip that changed for some other reason
  // is still the one the next turn is played out from.
  useLayoutEffect(() => {
    const previous = previousEntries.current;
    previousEntries.current = entries;

    // How far along the strip the new head of the queue was standing. The first
    // render has nothing to play out, and neither does a re-render the queue
    // slept through — the head is where it was, so the shift is nothing.
    const shift = previous.findIndex(
      (entry) => entry.kind === "unit" && entry.unit.id === head.id,
    );
    if (shift < 1) {
      return;
    }

    setLeaving(previous.slice(0, shift));
    // The cards the strip has kept are the ones the round before it did not drop,
    // and they lead the new strip in the order they were already in. So the first
    // card that is new is the one standing behind the last of them, and every
    // card from there to the tail came in this turn.
    setEnteringFrom(previous.length - shift);
    setPhase("start");
  });

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
      setLeaving([]);
    }, HIGHLIGHT_MS);

    return () => window.clearTimeout(timer);
  }, [phase]);

  // The enemies whose cards have just been put on the strip, and how many slots
  // the strip has gained by them. The cards named here rise into their slots.
  // The round behind them starts that many slots to the left of where the new
  // strip has put it.
  const [interruptEntering, setInterruptEntering] = useState<ReadonlySet<string>>(NO_INTERRUPTS);

  const [interruptShift, setInterruptShift] = useState(0);

  const [interruptPhase, setInterruptPhase] = useState<"idle" | "start" | "run">("idle");

  const previousInterrupts = useRef(interrupts);

  // Before paint, and for the same reason the handover is: the cards are on the
  // strip the moment the window opens, so the render that brings them in has to
  // be the render they are pinned in.
  //
  // Only a window opening is played out. A swing answered takes the card at the
  // front off the strip, and that is the strip losing a card rather than gaining
  // one — the last of them goes as the turn is handed on, and the handover is
  // what the bar tells then.
  useLayoutEffect(() => {
    const previous = previousInterrupts.current;
    previousInterrupts.current = interrupts;

    const held = new Set(previous.map((unit) => unit.id));
    const fresh = interrupts.filter((unit) => !held.has(unit.id));
    if (fresh.length === 0) {
      return;
    }

    setInterruptEntering(new Set(fresh.map((unit) => unit.id)));
    setInterruptShift(Math.max(0, interrupts.length - previous.length));
    setInterruptPhase("start");
  });

  useLayoutEffect(() => {
    if (interruptPhase !== "start") {
      return;
    }

    void trackRef.current?.offsetWidth;
    setInterruptPhase("run");
  }, [interruptPhase]);

  // Nothing is flashed at the end of this one — the card being asked beats in
  // red on its own for as long as the window stands — so the animation is over
  // with the slide.
  useEffect(() => {
    if (interruptPhase !== "run") {
      return;
    }

    const timer = window.setTimeout(() => {
      setInterruptPhase("idle");
      setInterruptEntering(NO_INTERRUPTS);
    }, SLIDE_MS);

    return () => window.clearTimeout(timer);
  }, [interruptPhase]);

  // How far the strip is pinned back to start the slide from: one slot per card
  // that has just dropped off its front. One slot between turns, when no card
  // has — nothing is pinned then, and an ordinary turn is the better guess than
  // no slide at all.
  //
  // The interrupt pin is the other direction and counted its own way, so it is
  // carried separately. Only one of the two is ever being animated.
  const shiftStyle = {
    "--interrupt-shift": String(interruptShift),
    "--turn-shift": String(Math.max(1, leaving.length)),
  } as CSSProperties;

  return (
    <div
      className={styles.turnOrder}
      data-interrupt-phase={interruptPhase}
      data-opportunity={interrupts.length > 0 ? "true" : undefined}
      data-phase={phase}
      style={TURN_TIMINGS}
    >
      <div className={styles.turnHeader}>
        <span className={styles.turnHeaderTitle}>Текущий ход</span>
        <span className={styles.turnHeaderRound}>{round}</span>
      </div>

      <div className={styles.turnCards}>
        <div className={styles.turnTrack} ref={trackRef} style={shiftStyle}>
          {/* In front of the round, because that is where they come in the
              playing of it: the round is on hold until the last of them has
              answered. The one at the head is the enemy being asked now. */}
          {interrupts.map((unit, index) => (
            <OpportunityCard
              acting={index === 0}
              entering={interruptEntering.has(unit.id)}
              key={`opportunity-${unit.id}`}
              unit={unit}
            />
          ))}
          {entries.map((entry, index) => (
            <TurnEntryCard
              acting={index === 0}
              entering={index >= enteringFrom}
              entry={entry}
              key={entry.key}
              threatened={entry.kind === "unit" && entry.unit.id === victimId}
            />
          ))}
        </div>

        {leaving.map((entry, slot) => (
          <LeavingCard entry={entry} key={entry.key} slot={slot} />
        ))}
      </div>
    </div>
  );
}

// A card in the strip, whichever of the two kinds it is. The round line takes no
// clicks: it stands for a moment in the round rather than for anybody on the
// board.
function TurnEntryCard({
  acting,
  entering,
  entry,
  threatened,
}: {
  acting: boolean;
  entering: boolean;
  entry: TurnEntry;
  threatened: boolean;
}) {
  if (entry.kind === "round") {
    return <RoundCard entering={entering} round={entry.round} />;
  }

  return (
    <TurnCard
      acting={acting}
      entering={entering}
      threatened={threatened}
      unit={entry.unit}
    />
  );
}

function TurnCard({
  acting,
  entering,
  threatened,
  unit,
}: {
  acting: boolean;
  entering: boolean;
  threatened: boolean;
  unit: BattleUnit;
}) {
  const className = [
    styles.turnCard,
    styles[unit.side],
    acting ? styles.turnCardActive : "",
    // Over the gold the head of the queue wears: the unit is still the one to
    // move, and it is about to be swung at. Red wins while that is true.
    threatened ? styles.turnCardThreatened : "",
    entering ? styles.turnEnter : "",
  ]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <button
      className={className}
      onClick={() => onUnitCardClick(unit.id)}
      title={unit.title}
      type="button"
    >
      <TurnCardFace unit={unit} />
    </button>
  );
}

// An enemy holding a swing, drawn in front of the round it is interrupting. Not
// a turn and not a unit of the queue: it is on the strip for as long as the
// window is, and takes no clicks — the swing is answered on the board or with
// the button under the roster, not here.
//
// The card and the word under it rise as one, so the slot is what carries the
// animation rather than the frame inside it.
function OpportunityCard({
  acting,
  entering,
  unit,
}: {
  acting: boolean;
  entering: boolean;
  unit: BattleUnit;
}) {
  const slotClassName = [styles.opportunitySlot, entering ? styles.interruptEnter : ""]
    .filter((part) => part !== "")
    .join(" ");

  const className = [
    styles.turnCard,
    styles.opportunityCard,
    acting ? styles.opportunityCardActive : "",
  ]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <div className={slotClassName}>
      <div className={className} title={unit.title}>
        <TurnCardFace unit={unit} />
      </div>
      <span className={styles.opportunityLabel}>Оппортун</span>
    </div>
  );
}

// The line the round after this one begins on. Not a unit and not a turn: the
// cards in front of it are what the round has left to run, and it goes when the
// round it names has come round.
function RoundCard({ entering, round }: { entering: boolean; round: number }) {
  const className = [styles.turnCard, styles.turnRound, entering ? styles.turnEnter : ""]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <div className={className}>
      <RoundCardFace round={round} />
    </div>
  );
}

// A card that has just dropped off the front of the strip, left over the slot it
// held for the length of the animation. It is a ghost of a card the strip has
// either taken back at its tail or dropped altogether, so it takes no clicks and
// answers no screen reader.
//
// `slot` is how far along the strip the card was standing, which is where the
// ghost is drawn: the unit that has just moved was at the head, and the round
// line ending a round was the card behind it.
function LeavingCard({ entry, slot }: { entry: TurnEntry; slot: number }) {
  const className = [
    styles.turnCard,
    styles.turnLeave,
    entry.kind === "unit" ? styles[entry.unit.side] : styles.turnRound,
    entry.kind === "unit" ? styles.turnCardActive : "",
  ]
    .filter((part) => part !== "")
    .join(" ");

  const slotStyle = { "--turn-leave-slot": String(slot) } as CSSProperties;

  return (
    <div aria-hidden="true" className={className} style={slotStyle}>
      {entry.kind === "unit" ? (
        <TurnCardFace unit={entry.unit} />
      ) : (
        <RoundCardFace round={entry.round} />
      )}
    </div>
  );
}

function RoundCardFace({ round }: { round: number }) {
  return <span className={styles.turnRoundLabel}>Ход {round}</span>;
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
