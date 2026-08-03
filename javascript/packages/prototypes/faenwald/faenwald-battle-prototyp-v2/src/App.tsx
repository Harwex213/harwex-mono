import { Button, Meter, Separator } from "@hw/faenwald-uikit";
import { useSignals } from "@preact/signals-react/runtime";
import {
  attackerHp,
  damageUnit,
  defenderHp,
  nextRound,
  round,
  selectedUnit,
  selectedUnitId,
  selectUnit,
  units,
  type Unit,
} from "./state/battle-state";
import styles from "./app.module.css";

function App() {
  // `useSignals` subscribes this component to every signal read below. The
  // repo has no Babel step, so the auto-tracking transform is unavailable and
  // each component that reads `.value` opts in by hand.
  useSignals();

  const active = selectedUnit.value;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>Faenwald Battle — Prototype v2</h1>
        <span className={styles.round}>Round {round.value}</span>
        <Button.Root size="sm" variant="secondary" onClick={nextRound}>
          End round
        </Button.Root>
      </header>

      <Separator.Root />

      <section className={styles.sides}>
        <Meter.Root max={65} value={attackerHp.value}>
          <Meter.Label>Attacker HP</Meter.Label>
          <Meter.Value />
          <Meter.Track>
            <Meter.Indicator />
          </Meter.Track>
        </Meter.Root>

        <Meter.Root max={80} value={defenderHp.value}>
          <Meter.Label>Defender HP</Meter.Label>
          <Meter.Value />
          <Meter.Track>
            <Meter.Indicator />
          </Meter.Track>
        </Meter.Root>
      </section>

      <section className={styles.roster}>
        {units.value.map((unit) => (
          <UnitCard key={unit.id} unit={unit} />
        ))}
      </section>

      <footer className={styles.footer}>
        {active === null ? (
          <span className={styles.hint}>Select a unit to attack it.</span>
        ) : (
          <>
            <span className={styles.hint}>
              {active.name} — {active.hp} / {active.maxHp} HP
            </span>
            <Button.Root
              disabled={active.hp === 0}
              onClick={() => damageUnit(active.id, 5)}
              variant="danger"
            >
              Deal 5 damage
            </Button.Root>
          </>
        )}
      </footer>
    </div>
  );
}

function UnitCard({ unit }: { unit: Unit }) {
  useSignals();

  const isSelected = selectedUnitId.value === unit.id;

  return (
    <button
      className={isSelected ? `${styles.unit} ${styles.unitSelected}` : styles.unit}
      onClick={() => selectUnit(unit.id)}
      type="button"
    >
      <span className={styles.unitName}>{unit.name}</span>
      <span className={styles.unitSide}>{unit.side}</span>
      <span className={styles.unitHp}>
        {unit.hp} / {unit.maxHp}
      </span>
    </button>
  );
}

export { App };
