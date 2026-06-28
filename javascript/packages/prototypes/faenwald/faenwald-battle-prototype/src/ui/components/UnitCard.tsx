/**
 * View layer — the selected unit's card (§3 stats, §5 abilities).
 *
 * A side panel showing the unit's full **effective** stats — HP, morale,
 * attack and speed after rank → count → degradation (§3.2–3.4) — plus rank,
 * count, ammo and the list of active modifiers (the half-health rule, strength
 * loss, ruler aura, catalog perks, abilities) and the terrain it stands on.
 * Damage-affecting modifiers are surfaced now so later phases stay verifiable.
 */

import type { ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import type { Board } from '@/model/board';
import type { AbilityId } from '@/model/catalog';
import type { UnitState } from '@/model/unit-state';
import { TERRAIN } from '@/model/terrain';
import styles from './UnitCard.module.css';

const ROMAN = ['—', 'I', 'II', 'III', 'IV', 'V', 'VI'];

const ABILITY_LABEL: Record<AbilityId, string> = {
  closeFormation: 'Close Formation',
  breakthrough: 'Breakthrough',
  ramStrike: 'Ram Strike',
  maneuverability: 'Maneuverability',
  dismount: 'Dismount',
  rangedAttack: 'Ranged Attack',
};

/** Rank's modifier vs the rank-II base (§3.3), as a signed percentage label. */
function rankModifierLabel(rank: number): string {
  const pct = (rank - 2) * 25;
  if (pct === 0) return 'base';
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

/** Human-readable lines for the catalog's numeric matchup perks (§4). */
function perkLines(unit: UnitState): string[] {
  const { perks } = unit.def;
  const lines: string[] = [];
  if (perks.takesFromRanged !== undefined) lines.push(`Takes ×${perks.takesFromRanged} from ranged`);
  if (perks.takesFromCharge !== undefined) lines.push(`Takes ×${perks.takesFromCharge} from charge`);
  if (perks.dealsToRear !== undefined) lines.push(`Deals ×${perks.dealsToRear} to rear`);
  if (perks.dealsToRanged !== undefined) lines.push(`Deals ×${perks.dealsToRanged} to ranged`);
  if (perks.rearActsAsFlank) lines.push('Rear hits count as flank for morale');
  if (perks.notes) lines.push(...perks.notes);
  return lines;
}

interface UnitCardProps {
  unit: UnitState;
  board: Board;
}

export const UnitCard = observer(({ unit, board }: UnitCardProps) => {
  const tile = board.get(unit.hex);
  const terrain = tile ? TERRAIN[tile.terrain] : null;
  const isRanged = unit.category === 'ranged';
  const perks = perkLines(unit);

  const modifiers: string[] = [];
  if (unit.bloodied) modifiers.push('Below half health → attack ×0.5 (§3.4)');
  if (unit.strengthMod < 1) modifiers.push(`Entered at ${Math.round(unit.strengthMod * 100)}% strength (§3.5)`);
  if (unit.isRuler) modifiers.push('Ruler — allied units gain +10 morale (§11.3)');
  if (unit.auraMorale > 0) modifiers.push(`Ruler aura — +${unit.auraMorale} morale while the ruler stands (§11.3)`);

  return (
    <aside className={styles.card}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.name}>
            {unit.isRuler && <span title="Ruler">👑 </span>}
            {unit.name}
          </h2>
          <p className={styles.subtitle}>
            {unit.icon} {unit.def.category} · {unit.def.subtype}
          </p>
        </div>
        <span className={`${styles.sideChip} ${styles[unit.side]}`}>{unit.side}</span>
      </header>

      <div className={styles.stats}>
        <Stat label="Health" value={`${unit.hp} / ${unit.maxHp}`} accent="#6aa84f" />
        <Stat label="Morale" value={`${unit.morale} / ${unit.effectiveMaxMorale}`} accent="#d8a657" />
        <Stat
          label="Attack"
          value={unit.bloodied ? `${unit.attack}  (½ of ${unit.enteringAttack})` : `${unit.attack}`}
          accent="#cf5048"
        />
        <Stat label="Speed" value={`${unit.def.speed}`} accent="#7aa7d8" />
      </div>

      <dl className={styles.meta}>
        <Meta label="Rank" value={`${ROMAN[unit.rank]} (${rankModifierLabel(unit.rank)})`} />
        <Meta label="Count" value={`${unit.count} / 100`} />
        {isRanged && <Meta label="Ammo" value={`${unit.shotsLeft} / ${unit.def.ammo ?? 0} shots`} />}
        <Meta label="Terrain" value={terrain ? `${terrain.glyph} ${terrain.name}` : 'unknown'} />
        {tile && tile.elevation > 0 && <Meta label="Elevation" value={`level ${tile.elevation}`} />}
        {tile?.state && <Meta label="Tile state" value={tile.state} />}
      </dl>

      {modifiers.length > 0 && (
        <Section title="Active modifiers">
          {modifiers.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </Section>
      )}

      {unit.def.abilities.length > 0 && (
        <Section title="Abilities">
          {unit.def.abilities.map((id) => (
            <li key={id}>{ABILITY_LABEL[id]}</li>
          ))}
        </Section>
      )}

      <Section title="Catalog perks">
        {perks.length > 0 ? (
          perks.map((line) => <li key={line}>{line}</li>)
        ) : (
          <li className={styles.muted}>None</li>
        )}
      </Section>
    </aside>
  );
});

const Stat = ({ label, value, accent }: { label: string; value: string; accent: string }) => (
  <div className={styles.stat}>
    <span className={styles.statLabel}>{label}</span>
    <span className={styles.statValue} style={{ color: accent }}>
      {value}
    </span>
  </div>
);

const Meta = ({ label, value }: { label: string; value: string }) => (
  <div className={styles.metaRow}>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className={styles.section}>
    <h3 className={styles.sectionTitle}>{title}</h3>
    <ul className={styles.list}>{children}</ul>
  </section>
);
