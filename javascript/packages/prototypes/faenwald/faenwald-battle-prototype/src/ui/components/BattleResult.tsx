/**
 * View layer — the battle-result screen (GDD §11.4, §12, §13).
 *
 * Shown once {@link BattleStore.isBattleOver}. Summarises the strategic outputs
 * of the battle: the victor (§11.4), each side's ruler fate (§11.3), and a
 * per-unit breakdown of survivors, permanent losses (killed + prisoners, §12)
 * and the rank chevrons earned (§13). Reads everything from the store's pure
 * {@link BattleStore.postBattleReport}; it renders, it does not compute.
 */

import { observer } from 'mobx-react-lite';
import type { BattleStore } from '@/model/battle-store';
import type { SideLossSummary, UnitLosses } from '@/model/battle-end';
import type { RulerFate } from '@/model/morale';
import type { Side } from '@/model/types';
import styles from './BattleResult.module.css';

interface BattleResultProps {
  store: BattleStore;
}

const SIDE_LABEL: Record<Side, string> = { blue: 'Blue', red: 'Red' };
const FATE_LABEL: Record<RulerFate, string> = {
  killed: '👑 ruler slain',
  captured: '👑 ruler captured',
  fled: '👑 ruler fled',
};

/** Short status tag for a unit's end state (§11.1, §12.1). */
function statusOf(unit: UnitLosses): { label: string; cls: string } {
  if (unit.destroyed) return { label: 'destroyed', cls: styles.destroyed };
  if (unit.routed) return { label: 'routed', cls: styles.routed };
  return { label: 'survived', cls: styles.survived };
}

const SidePanel = observer(({ summary, fate }: { summary: SideLossSummary; fate: RulerFate | null }) => (
  <section className={`${styles.side} ${styles[summary.side]}`}>
    <header className={styles.sideHead}>
      <span className={styles.sideName}>{SIDE_LABEL[summary.side]}</span>
      {fate && <span className={styles.fate}>{FATE_LABEL[fate]}</span>}
    </header>

    <table className={styles.table}>
      <thead>
        <tr>
          <th>Unit</th>
          <th>Status</th>
          <th title="Soldiers surviving">Left</th>
          <th title="Soldiers killed">Killed</th>
          <th title="Soldiers taken prisoner (§12.2)">POW</th>
          <th title="Rank chevrons earned (§13)">Rank</th>
        </tr>
      </thead>
      <tbody>
        {summary.units.map((unit) => {
          const status = statusOf(unit);
          return (
            <tr key={unit.unitId}>
              <td className={styles.unit}>{unit.unitName}</td>
              <td>
                <span className={`${styles.status} ${status.cls}`}>{status.label}</span>
              </td>
              <td className={styles.num}>{unit.survivors}</td>
              <td className={styles.num}>{unit.killed || '—'}</td>
              <td className={styles.num}>{unit.prisoners || '—'}</td>
              <td className={styles.num}>{unit.chevrons ? `+${unit.chevrons}` : '—'}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2}>Total ({summary.totalEntering} soldiers)</td>
          <td className={styles.num}>{summary.totalSurvivors}</td>
          <td className={styles.num}>{summary.totalKilled}</td>
          <td className={styles.num}>{summary.totalPrisoners}</td>
          <td className={styles.num}>—</td>
        </tr>
      </tfoot>
    </table>
  </section>
));

export const BattleResult = observer(({ store }: BattleResultProps) => {
  const report = store.postBattleReport;
  const { outcome, winner } = report.end;

  const headline =
    outcome === 'draw'
      ? 'Mutual destruction'
      : winner
        ? `${SIDE_LABEL[winner]} carries the field`
        : 'Battle ongoing';

  return (
    <section className={styles.result}>
      <header className={styles.head}>
        <span className={styles.banner}>⚔️ Battle over</span>
        <h2 className={styles.headline}>{headline}</h2>
        <p className={styles.note}>
          Permanent losses are 50% of the health a retreating unit lost; a destroyed unit is lost in
          full, ~half taken prisoner (§12).
        </p>
      </header>

      <SidePanel summary={report.blue} fate={store.rulerFate.blue} />
      <SidePanel summary={report.red} fate={store.rulerFate.red} />

      <button className={styles.replay} onClick={() => void store.reset()}>
        ↻ Replay battle
      </button>
    </section>
  );
});
