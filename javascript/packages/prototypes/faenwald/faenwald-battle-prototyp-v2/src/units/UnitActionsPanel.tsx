import { Tooltip } from "@hw/faenwald-uikit";
import { useEffect, type ReactNode } from "react";
import type { UnitModifier } from "../state/formations";
import type { UnitStats } from "../state/units-state";
import {
  AccelerateIcon,
  AttackIcon,
  CanopyIcon,
  FindIcon,
  MoveIcon,
  RotateIcon,
} from "../ui/icons";
import { isTyping } from "../ui/keyboard";
import { ModifierList } from "../ui/ModifierList";
import styles from "./unit-actions-panel.module.css";

// Only what the card shows. Each page keeps its own unit shape — a roster entry
// before the battle, a deployed unit during it — and both answer this much.
type ActionsUnit = {
  title: string;
  stats: UnitStats;
};

// What the unit has left to spend on the board this turn, against what it
// started the turn with.
type Moves = {
  left: number;
  total: number;
};

type UnitActionsPanelProps = {
  unit: ActionsUnit;
  // Whether this unit is already waiting for the hex to move to.
  moving: boolean;
  // Whether its rotation handles are already out.
  rotating: boolean;
  // Whether it is already waiting for the unit to strike.
  attacking?: boolean;
  // Whether there is anyone in reach at all. An attack with nobody to swing at
  // stays silent, so the button goes quiet rather than arming an empty board.
  // Left out by a page whose attack is unconditional.
  canAttack?: boolean;
  onMove: () => void;
  onRotate: () => void;
  // Disarms whatever is armed, leaving the unit as it stands.
  onCancel: () => void;
  // Left out by a page that does not ration movement — the disposition board
  // lets a unit be nudged as often as the player likes. Where it is given, the
  // card reports it, and a unit down to nothing can neither step nor turn.
  moves?: Moves;
  // What the unit is carrying because of where it stands — Сомкнутый Строй and
  // whatever comes after it. Listed rather than acted on: the card reports the
  // modifiers, and the board is what gives and takes them away. Empty for a unit
  // carrying none, and left out by a page with no modifiers of its own.
  modifiers?: UnitModifier[];
  // Orders only the battle takes. Each one is left out where the page has no
  // handler for it, button and shortcut alike.
  onAccelerate?: () => void;
  // Accelerate has a price of its own — morale, and something left to spend this
  // turn — so it goes quiet on its own terms rather than with the two orders
  // that move the unit. The page works out whether the unit can pay.
  accelerateDisabled?: boolean;
  onAttack?: () => void;
  // What the unit's attack is called, for the button that arms it. Every unit
  // has one attack, and which one it is worth saying: a blow landed by hand and a
  // volley lobbed over four hexes are armed with the same key.
  attackLabel?: string;
  // Whether the board is drawing the unit's canopy cone. Left out — along with
  // the switch itself — for a unit that does not shoot, and by a page with no
  // cone to draw.
  coneShown?: boolean;
  onConeToggle?: (shown: boolean) => void;
  // Brings the unit into view. Not an order — nothing on the board changes — so
  // this one answers whether or not the unit is taking orders.
  onFind?: () => void;
  // The unit is on screen to be read, not commanded. The card stays, the
  // buttons and their shortcuts go quiet.
  disabled?: boolean;
};

// What a selected unit can be told to do. Overlays a canvas corner, so it needs
// a positioned box around the canvas — same requirement as `InfoPanel`.
// Prop-driven, so the page decides which unit it belongs to.
function UnitActionsPanel({
  unit,
  moving,
  rotating,
  attacking = false,
  canAttack = true,
  onMove,
  onRotate,
  onCancel,
  moves,
  modifiers = NO_MODIFIERS,
  onAccelerate,
  accelerateDisabled = false,
  onAttack,
  attackLabel = "Attack",
  coneShown = false,
  onConeToggle,
  onFind,
  disabled = false,
}: UnitActionsPanelProps) {
  // A unit that has spent its allowance stays on screen and stays selected. It
  // is the two orders that take it across the board that go quiet.
  const spent = moves !== undefined && moves.left === 0;

  // The panel is on screen exactly while a unit is selected, so the shortcuts can
  // live with the buttons they stand for: mounting the panel arms them. A key is
  // dropped wherever the button it stands for is muted or absent, so a shortcut
  // never does what the panel says cannot be done.
  useEffect(() => {
    // A muted card keeps its F: the unit is on screen to be read, and looking
    // for it on the board is part of reading it.
    const handlers: Record<Action, (() => void) | undefined> = {
      move: disabled || spent ? undefined : onMove,
      rotate: disabled || spent ? undefined : onRotate,
      accelerate: disabled || accelerateDisabled ? undefined : onAccelerate,
      attack: !disabled && canAttack ? onAttack : undefined,
      // Live on a muted card, the way F is: the cone says what the board draws,
      // not what the unit does, so it answers for a unit that takes no orders.
      cone: onConeToggle === undefined ? undefined : () => onConeToggle(!coneShown),
      find: onFind,
      cancel: disabled ? undefined : onCancel,
    };

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) {
        return;
      }

      const action = SHORTCUTS[event.key.toLowerCase()];
      if (action === undefined) {
        return;
      }

      const handler = handlers[action];
      if (handler === undefined) {
        return;
      }

      event.preventDefault();
      handler();
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    accelerateDisabled,
    canAttack,
    coneShown,
    disabled,
    onAccelerate,
    onAttack,
    onCancel,
    onConeToggle,
    onFind,
    onMove,
    onRotate,
    spent,
  ]);

  return (
    <div className={styles.panel}>
      <div className={styles.card}>
        <div className={styles.title}>{unit.title}</div>
        <div className={styles.stats}>
          <span>{unit.stats.health} ❤️</span>
          <span>{unit.stats.attack} ⚔️</span>
          <span>{unit.stats.morale} 🎺</span>
        </div>
        {/* Between the stats and the turn: a modifier is something about the unit
            rather than about what it has left to spend, and the rule under it is
            already drawn by the row below. */}
        <ModifierList modifiers={modifiers} />
        {moves === undefined ? null : (
          <div className={spent ? `${styles.moves} ${styles.movesSpent}` : styles.moves}>
            <span className={styles.movesLabel}>Moves left</span>
            <span className={styles.movesValue}>
              {moves.left} / {moves.total}
            </span>
          </div>
        )}
      </div>

      {/* One row of icons rather than a stack of named buttons, so the card is
          short enough to leave the board it overlays readable. A button says
          only what it does, and the name behind it is a hover away. The
          shortcut is in the same hint, so the two ways of giving an order are
          learnt together. */}
      <Tooltip.Provider delay={TOOLTIP_DELAY}>
        <div className={styles.actions}>
          {/* Lit while armed, so the panel says what the next click on the board
              means. */}
          <ActionButton
            armed={moving}
            disabled={disabled || spent}
            hint={spent ? SPENT_HINT : undefined}
            icon={<MoveIcon />}
            label="Move"
            onClick={onMove}
            shortcut="W"
          />

          <ActionButton
            armed={rotating}
            disabled={disabled || spent}
            hint={spent ? SPENT_HINT : undefined}
            icon={<RotateIcon />}
            label="Rotate"
            onClick={onRotate}
            shortcut="R"
          />

          {/* The four below are drawn only where the page passes a handler, so
              the disposition board keeps the two orders it has always had. */}
          {/* Quiet where the unit cannot pay for the order — out of morale, or
              with nothing left this turn for the order to double. */}
          {onAccelerate === undefined ? null : (
            <ActionButton
              disabled={disabled || accelerateDisabled}
              icon={<AccelerateIcon />}
              label="Accelerate"
              onClick={onAccelerate}
              shortcut="C"
            />
          )}

          {/* Lit while armed, the way Move and Rotate are: the panel says what
              the next click on the board means. Quiet with nobody in reach. The
              name in the hint is the attack's own, so the card says which one
              the key arms. */}
          {onAttack === undefined ? null : (
            <ActionButton
              armed={attacking}
              disabled={disabled || !canAttack}
              hint={canAttack ? undefined : NO_TARGET_HINT}
              icon={<AttackIcon />}
              label={attackLabel}
              onClick={onAttack}
              shortcut="A"
            />
          )}

          {/* Apart from the orders, because neither one is: the buttons on the
              left turn something on the board into something else, while these
              two only change what the board draws and where it is looking. */}
          {onConeToggle === undefined && onFind === undefined ? null : (
            <div className={styles.aids}>
              {/* Only there for a unit that shoots. Lit while the cone is
                  drawn, so the button says what is on the board. */}
              {onConeToggle === undefined ? null : (
                <ActionButton
                  armed={coneShown}
                  icon={<CanopyIcon />}
                  label="Canopy cone"
                  onClick={() => onConeToggle(!coneShown)}
                  shortcut="E"
                />
              )}

              {/* Live on a muted card, for the reason the shortcut above is. */}
              {onFind === undefined ? null : (
                <ActionButton
                  icon={<FindIcon />}
                  label="Find"
                  onClick={onFind}
                  shortcut="F"
                />
              )}
            </div>
          )}
        </div>
      </Tooltip.Provider>
    </div>
  );
}

type ActionButtonProps = {
  icon: ReactNode;
  // What the button would be called if it were still named on the card. The
  // hint carries it, and a screen reader reads it off the button itself.
  label: string;
  // The key that gives the same order, as `SHORTCUTS` spells it.
  shortcut: string;
  // Why the button is quiet, where the panel knows. Left out where it is not
  // quiet at all, and where the reason is the page's rather than the panel's.
  hint?: string;
  // Lit, because the next click on the board belongs to this order.
  armed?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

// One icon, one order. The button carries its own hint, because an icon with no
// name needs one: a player who does not know the shape reads it here.
//
// `aria-disabled` rather than `disabled`, so a quiet button still answers the
// pointer. A disabled button takes no pointer events at all, and the hint over
// the one order the unit cannot afford is the hint most worth reading.
function ActionButton({
  icon,
  label,
  shortcut,
  hint,
  armed = false,
  disabled = false,
  onClick,
}: ActionButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        aria-disabled={disabled}
        aria-label={label}
        className={armed ? `${styles.action} ${styles.actionArmed}` : styles.action}
        onClick={disabled ? undefined : onClick}
      >
        {icon}
      </Tooltip.Trigger>
      {/* Under the button rather than over it. The row is the bottom of the
          card, and a hint above it would cover the unit it belongs to. */}
      <Tooltip.Portal>
        <Tooltip.Positioner side="bottom">
          <Tooltip.Popup className={styles.tip}>
            <Tooltip.Arrow />
            <span className={styles.tipTitle}>
              {label}
              <kbd className={styles.tipKey}>{shortcut}</kbd>
            </span>
            {hint === undefined ? null : <span className={styles.tipHint}>{hint}</span>}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

// A unit carrying nothing. One value rather than a fresh empty array per render,
// so the card a page passes no modifiers to is handed the same list every time.
const NO_MODIFIERS: UnitModifier[] = [];

// No wait before a hint is shown. An icon stands for nothing but the order
// behind it, so a pointer resting on one has already asked what it is — the same
// reason the ⓘ beside the army list answers at once.
const TOOLTIP_DELAY = 0;

// Why the two orders that cross the board are quiet. The count on the card says
// the same thing, and a pointer on the button it disarmed should not have to
// look for it.
const SPENT_HINT = "Nothing left to spend this turn";

const NO_TARGET_HINT = "Nobody in reach";

type Action = "move" | "rotate" | "accelerate" | "attack" | "cone" | "find" | "cancel";

// `event.key` lowercased, so `Escape` arrives as `escape`.
const SHORTCUTS: Record<string, Action> = {
  w: "move",
  r: "rotate",
  c: "accelerate",
  a: "attack",
  e: "cone",
  f: "find",
  escape: "cancel",
};

export { UnitActionsPanel };
