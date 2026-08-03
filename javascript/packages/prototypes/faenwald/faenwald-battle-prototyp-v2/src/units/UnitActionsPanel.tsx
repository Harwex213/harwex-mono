import { Button, Checkbox } from "@hw/faenwald-uikit";
import { useEffect } from "react";
import type { UnitStats } from "../state/units-state";
import { isTyping } from "../ui/keyboard";
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
        {moves === undefined ? null : (
          <div className={spent ? `${styles.moves} ${styles.movesSpent}` : styles.moves}>
            <span className={styles.movesLabel}>Moves left</span>
            <span className={styles.movesValue}>
              {moves.left} / {moves.total}
            </span>
          </div>
        )}
      </div>

      {/* Lit while armed, so the panel says what the next click on the board
          means. */}
      <Button.Root
        className={styles.action}
        disabled={disabled || spent}
        onClick={onMove}
        variant={moving ? "primary" : "secondary"}
      >
        Move (W)
      </Button.Root>

      <Button.Root
        className={styles.action}
        disabled={disabled || spent}
        onClick={onRotate}
        variant={rotating ? "primary" : "secondary"}
      >
        Rotate (R)
      </Button.Root>

      {/* The three below are drawn only where the page passes a handler, so the
          disposition board keeps the two orders it has always had. */}
      {/* Quiet where the unit cannot pay for the order — out of morale, or with
          nothing left this turn for the order to double. */}
      {onAccelerate === undefined ? null : (
        <Button.Root
          className={styles.action}
          disabled={disabled || accelerateDisabled}
          onClick={onAccelerate}
          variant="secondary"
        >
          Accelerate (C)
        </Button.Root>
      )}

      {/* Lit while armed, the way Move and Rotate are: the panel says what the
          next click on the board means. Quiet with nobody in reach. The label is
          the attack's own, so the card says which one the key arms. */}
      {onAttack === undefined ? null : (
        <Button.Root
          className={styles.action}
          disabled={disabled || !canAttack}
          onClick={onAttack}
          variant={attacking ? "primary" : "secondary"}
        >
          {attackLabel} (A)
        </Button.Root>
      )}

      {/* Under the order it belongs to, and a switch rather than a button: it
          turns something on and leaves it on, while every button above it does one
          thing and is done. Only drawn for a unit that shoots. */}
      {onConeToggle === undefined ? null : (
        <label className={styles.toggle}>
          <Checkbox.Root checked={coneShown} onCheckedChange={onConeToggle}>
            <Checkbox.Indicator />
          </Checkbox.Root>
          Canopy cone (E)
        </label>
      )}

      {/* Live on a muted card, for the reason the shortcut above is. */}
      {onFind === undefined ? null : (
        <Button.Root className={styles.action} onClick={onFind} variant="secondary">
          Find (F)
        </Button.Root>
      )}
    </div>
  );
}

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
