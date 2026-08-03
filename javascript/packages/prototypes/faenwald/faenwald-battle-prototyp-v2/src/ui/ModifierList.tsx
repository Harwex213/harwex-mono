import type { UnitModifier } from "../state/formations";
import styles from "./modifier-list.module.css";

// What a unit is carrying because of where it stands, as one chip each. The two
// panels that answer for a unit both draw this, so a modifier reads the same
// whichever of them the player is looking at.
//
// Presentation only: which unit the list belongs to is the caller's business, and
// nothing here knows what any one modifier does. A unit carrying nothing draws
// nothing at all rather than an empty row.
function ModifierList({ modifiers }: { modifiers: UnitModifier[] }) {
  if (modifiers.length === 0) {
    return null;
  }

  return (
    <div className={styles.list}>
      {modifiers.map((modifier) => (
        <span
          className={`${styles.chip} ${styles[modifier.sign]}`}
          key={modifier.id}
          title={modifier.hint}
        >
          <span aria-hidden="true" className={styles.icon}>
            {modifier.icon}
          </span>
          {modifier.label}
        </span>
      ))}
    </div>
  );
}

export { ModifierList };
