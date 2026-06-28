/**
 * View layer — the turn / initiative tracker (GDD §6.1, Appendix B).
 *
 * Shows the current battle-turn number and the order in which units act this
 * turn — speed desc → category (cavalry > ranged > shock > spear) → Blue/Red
 * alternation. The unit whose turn it is is highlighted; units that have already
 * acted are dimmed; removed (destroyed/routed) units fall out of the list. The
 * "Next unit" button hands initiative on, wrapping into the next battle turn.
 */

import { observer } from 'mobx-react-lite';
import type { BattleStore } from '@/model/battle-store';
import styles from './TurnTracker.module.css';

interface TurnTrackerProps {
  store: BattleStore;
}

export const TurnTracker = observer(({ store }: TurnTrackerProps) => {
  const active = store.activeUnit;

  return (
    <section className={styles.tracker}>
      <header className={styles.head}>
        <span className={styles.turn}>Turn {store.turn}</span>
        <button className={styles.next} onClick={() => store.advance()} disabled={active === null}>
          Next unit ▸
        </button>
      </header>

      <ol className={styles.order}>
        {store.orderedUnits.map((unit) => {
          const isActive = unit.id === active?.id;
          const done = unit.hasActed && !isActive;
          const className = [
            styles.item,
            styles[unit.side],
            isActive ? styles.active : '',
            done ? styles.done : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <li key={unit.id} className={className} onClick={() => store.select(unit.id)}>
              <span className={styles.dot} aria-hidden />
              <span className={styles.icon}>{unit.icon}</span>
              <span className={styles.name}>{unit.name}</span>
              <span className={styles.speed} title="Movement speed">
                {unit.speed}⏵
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
});
