/**
 * View layer — the modifier & legend cheat-sheet overlay (showcase item 27).
 *
 * A reference card a viewer can open to map the numbers on screen back to the
 * GDD rules: the Appendix A modifier table (every multiplier the §9 pipeline can
 * apply), the Appendix B initiative ordering, and a terrain legend derived from
 * the engine's own {@link TERRAIN} table so the colours/glyphs always match the
 * board. Purely presentational — it reads no battle state.
 */

import { useEffect } from 'react';
import { TERRAIN, type TerrainType } from '@/model/terrain';
import styles from './CheatSheet.module.css';

interface CheatSheetProps {
  onClose: () => void;
}

/** Appendix A — every modifier the damage pipeline (§9) can apply, by channel. */
const MODIFIERS: { source: string; channel: string; value: string }[] = [
  { source: 'Flank hit', channel: 'morale', value: '×1.25' },
  { source: 'Rear hit', channel: 'morale', value: '×1.5 (shock: ×1.25)' },
  { source: 'Spearman rear', channel: 'physical', value: '×1.5 (extra)' },
  { source: 'Close formation, 1 flank', channel: 'incoming front', value: '×0.8' },
  { source: 'Close formation, 2 flanks', channel: 'incoming front', value: '×0.6' },
  { source: 'Hill vs foothill', channel: 'physical', value: '×1.25 / takes ×0.75' },
  { source: 'Hill vs lower adjacent', channel: 'physical', value: '×1.5 / takes ×0.5' },
  { source: 'Foothill vs lower', channel: 'physical', value: '×1.25 / takes ×0.75' },
  { source: 'Brush vs ranged', channel: 'physical', value: '×0.75' },
  { source: 'Forest vs ranged', channel: 'physical', value: '×0.5' },
  { source: 'Mud: light↔heavy (both in mud)', channel: 'physical', value: '×2' },
  { source: 'Charge (cavalry)', channel: 'physical', value: '1 + ramMod·hexes/100' },
  { source: 'Charge ≥3 hexes (cavalry)', channel: 'morale', value: '×1.25' },
  { source: 'Arcing / Direct / Close (ranged)', channel: 'physical', value: '×1 / ×2 / ×0.5' },
  { source: 'Crossbow close combat', channel: 'physical', value: '×0.75' },
  { source: 'Below 50% HP (bloodied)', channel: 'both', value: '×0.5 output' },
  { source: 'Hard cap (all attacks)', channel: 'both', value: '≤ ×3 natural (cav morale exempt)' },
];

/** A short effect blurb per terrain type for the legend (§10). */
const TERRAIN_EFFECT: Record<TerrainType, string> = {
  plain: 'No features; may turn to mud.',
  brush: 'Cavalry entry ×2; all take ×0.75 from ranged.',
  forest: 'Cavalry 1 hex, no accelerate; arc-fire limited; ×0.5 from ranged.',
  foothill: 'Elev 1. ×1.25 vs lower / ×0.75 vs hill. Climb ×2.',
  hill: 'Elev 2. ×1.25 vs foothill, ×1.5 vs lower adjacent. Climb ×2.',
  mountain: 'Impassable; blocks line of fire.',
  water: 'Impassable (freezes → plain in winter).',
  bog: 'Like mud; movement ×3.',
  road: 'Movement ×0.5.',
  settlement: 'No arcing fire onto it; spearmen +5% formation; cavalry −2 speed.',
};

const TERRAIN_ORDER: TerrainType[] = [
  'plain',
  'brush',
  'forest',
  'foothill',
  'hill',
  'mountain',
  'water',
  'bog',
  'road',
  'settlement',
];

export const CheatSheet = ({ onClose }: CheatSheetProps) => {
  // Close on Escape — a modal convention.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Modifier and legend cheat-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <h2 className={styles.title}>Cheat-sheet</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className={styles.body}>
          <section className={styles.section}>
            <h3 className={styles.heading}>Modifiers (Appendix A)</h3>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Channel</th>
                  <th>Multiplier</th>
                </tr>
              </thead>
              <tbody>
                {MODIFIERS.map((mod) => (
                  <tr key={mod.source}>
                    <td>{mod.source}</td>
                    <td className={styles.channel}>{mod.channel}</td>
                    <td className={styles.value}>{mod.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={styles.section}>
            <h3 className={styles.heading}>Initiative (Appendix B)</h3>
            <p className={styles.initiative}>
              speed&nbsp;desc → category (<strong>cav &gt; ranged &gt; shock &gt; spear</strong>) →
              side-alternate (Blue, Red)
            </p>

            <h3 className={styles.heading}>Terrain (§10)</h3>
            <ul className={styles.legend}>
              {TERRAIN_ORDER.map((type) => {
                const info = TERRAIN[type];
                return (
                  <li key={type} className={styles.legendItem}>
                    <span className={styles.swatch} style={{ background: info.color }}>
                      {info.glyph}
                    </span>
                    <span className={styles.legendText}>
                      <strong>{info.name}</strong> — {TERRAIN_EFFECT[type]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
};
