/**
 * View layer — the damage-preview tooltip (GDD goal: outcomes *obvious and
 * verifiable*; plan item 13).
 *
 * Renders a resolved {@link AttackResult} as a breakdown a viewer can check by
 * hand: the natural damage, **every** applied multiplier with its label and
 * value (§9.3), the raw product, the ×3 cap when it bites (§9.5) and the final
 * rounded damage per channel (§9.6). Used both as a floating tooltip on hover
 * and inline in the action bar.
 */

import type { AttackResult, ChannelResult } from '@/model/combat';
import styles from './DamagePreview.module.css';

interface DamagePreviewProps {
  attackerName: string;
  defenderName: string;
  result: AttackResult;
}

/** One channel's worth of breakdown: natural → ×modifiers → (cap) → final. */
const Channel = ({ title, channel, color }: { title: string; channel: ChannelResult; color: string }) => (
  <div className={styles.channel}>
    <div className={styles.channelHead}>
      <span className={styles.channelTitle} style={{ color }}>
        {title}
      </span>
      <span className={styles.final} style={{ color }}>
        {channel.damage}
      </span>
    </div>
    <ul className={styles.steps}>
      <li>
        <span className={styles.stepLabel}>Natural</span>
        <span className={styles.stepValue}>{channel.natural}</span>
      </li>
      {channel.modifiers.map((mod, i) => (
        <li key={`${mod.label}-${i}`}>
          <span className={styles.stepLabel}>{mod.label}</span>
          <span className={styles.stepValue}>×{mod.value}</span>
        </li>
      ))}
      {channel.capped && (
        <li className={styles.capped}>
          <span className={styles.stepLabel}>×3 cap (raw {round(channel.raw)})</span>
          <span className={styles.stepValue}>clamped</span>
        </li>
      )}
    </ul>
  </div>
);

/** Trim float noise from the raw value for display. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export const DamagePreview = ({ attackerName, defenderName, result }: DamagePreviewProps) => (
  <div className={styles.preview}>
    <p className={styles.title}>
      {attackerName} → {defenderName}
    </p>
    <Channel title="Physical" channel={result.physical} color="#cf5048" />
    <Channel title="Morale" channel={result.morale} color="#d8a657" />
  </div>
);
