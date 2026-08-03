import { Button } from "@hw/faenwald-uikit";
import { useEffect } from "react";
import type { RosterUnit } from "../state/disposition-state";
import styles from "./unit-actions-panel.module.css";

// Still wireframe: what these two do to the board is the next step. `Move` has
// its own row below, because it is the one that works.
const IDLE_ACTIONS = [
  { label: "Rotate", shortcut: "R" },
  { label: "Attack", shortcut: "A" },
];

const MOVE_KEY = "w";

type UnitActionsPanelProps = {
  unit: RosterUnit;
  // Whether this unit is already waiting for the hex to move to.
  moving: boolean;
  onMove: () => void;
};

// What a selected unit can be told to do. Overlays a canvas corner, so it needs
// a positioned box around the canvas — same requirement as `InfoPanel`.
// Prop-driven, so the page decides which unit it belongs to.
function UnitActionsPanel({ unit, moving, onMove }: UnitActionsPanelProps) {
  // The panel is on screen exactly while a unit is selected, so the shortcut can
  // live with the button it stands for: mounting the panel arms it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) {
        return;
      }

      if (event.key.toLowerCase() === MOVE_KEY) {
        event.preventDefault();
        onMove();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onMove]);

  return (
    <div className={styles.panel}>
      <div className={styles.card}>
        <div className={styles.title}>{unit.title}</div>
        <div className={styles.stats}>
          <span>{unit.stats.health} ❤️</span>
          <span>{unit.stats.attack} ⚔️</span>
          <span>{unit.stats.morale} 🎺</span>
        </div>
      </div>

      {/* Lit while the move is armed, so the panel says the next hex click goes
          to this unit. */}
      <Button.Root
        className={styles.action}
        onClick={onMove}
        variant={moving ? "primary" : "secondary"}
      >
        Move (W)
      </Button.Root>

      {IDLE_ACTIONS.map((action) => (
        <Button.Root className={styles.action} key={action.shortcut} variant="secondary">
          {action.label} ({action.shortcut})
        </Button.Root>
      ))}
    </div>
  );
}

// The page has a chat box on it, so a letter typed into a field must not reach
// the board.
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export { UnitActionsPanel };
