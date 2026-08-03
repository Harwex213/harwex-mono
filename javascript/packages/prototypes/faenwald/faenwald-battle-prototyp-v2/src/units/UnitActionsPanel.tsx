import { Button } from "@hw/faenwald-uikit";
import type { RosterUnit } from "../state/disposition-state";
import styles from "./unit-actions-panel.module.css";

// The letter each action will answer to once the keyboard is wired up. Shown in
// the label so the panel already teaches the shortcut.
const ACTIONS = [
  { label: "Move", shortcut: "W" },
  { label: "Rotate", shortcut: "R" },
  { label: "Attack", shortcut: "A" },
];

// What a selected unit can be told to do. Overlays a canvas corner, so it needs
// a positioned box around the canvas — same requirement as `InfoPanel`.
// Prop-driven, so the page decides which unit it belongs to.
function UnitActionsPanel({ unit }: { unit: RosterUnit }) {
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

      {ACTIONS.map((action) => (
        // No handlers yet: the panel is the wireframe, and what each action does
        // to the board is the next step.
        <Button.Root className={styles.action} key={action.shortcut} variant="secondary">
          {action.label} ({action.shortcut})
        </Button.Root>
      ))}
    </div>
  );
}

export { UnitActionsPanel };
