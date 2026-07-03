/**
 * View layer — playback controls (showcase item 26).
 *
 * Lets a viewer replay a battle deterministically end-to-end: pick a preset
 * **scenario** (§ item 25), set the **seed** behind the dice (§11.3), **step**
 * the auto-battler one action at a time, **auto-play** it to the finish, or
 * **reset** to turn 1. The auto-battler is fully deterministic (see
 * {@link BattleStore.autoStep}), so the same scenario + seed always produces the
 * same battle — the whole point of the seeded RNG (§0, §15.3).
 */

import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import type { BattleStore } from '@/model/battle-store';
import styles from './PlaybackControls.module.css';

interface PlaybackControlsProps {
  store: BattleStore;
}

/** Auto-play cadences (ms between auto-actions). */
const SPEEDS: { label: string; ms: number }[] = [
  { label: 'Slow', ms: 1100 },
  { label: 'Normal', ms: 600 },
  { label: 'Fast', ms: 250 },
];

export const PlaybackControls = observer(({ store }: PlaybackControlsProps) => {
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(SPEEDS[1].ms); // Normal
  const [seedText, setSeedText] = useState(String(store.seed));
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const over = store.isBattleOver;

  // Auto-play: tick the auto-battler on an interval until the battle ends.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const continues = store.autoStep();
      if (!continues) setPlaying(false);
    }, speedMs);
    return () => clearInterval(id);
  }, [playing, speedMs, store]);

  // The battle ending (or a reload) stops playback.
  useEffect(() => {
    if (over && playingRef.current) setPlaying(false);
  }, [over]);

  const stopThen = (run: () => void) => {
    setPlaying(false);
    run();
  };

  const applySeed = () => {
    const parsed = Number(seedText);
    if (Number.isFinite(parsed)) stopThen(() => void store.setSeed(parsed));
  };

  return (
    <section className={styles.controls}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="scenario">
          Scenario
        </label>
        <select
          id="scenario"
          className={styles.select}
          value={store.scenarioId ?? ''}
          onChange={(event) => stopThen(() => void store.selectScenario(event.target.value))}
        >
          {store.scenarios.map((scenario) => (
            <option key={scenario.id} value={scenario.id} title={scenario.mechanic}>
              {scenario.name}
            </option>
          ))}
        </select>
      </div>

      {store.scenarioMechanic && <p className={styles.mechanic}>{store.scenarioMechanic}</p>}

      <div className={styles.buttons}>
        <button
          className={styles.primary}
          onClick={() => (playing ? setPlaying(false) : setPlaying(true))}
          disabled={over}
        >
          {playing ? '⏸ Pause' : '▶ Auto-play'}
        </button>
        <button className={styles.ghost} onClick={() => stopThen(() => store.autoStep())} disabled={over}>
          ⏭ Step
        </button>
        <button className={styles.ghost} onClick={() => stopThen(() => void store.reset())}>
          ↺ Reset
        </button>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="speed">
          Speed
        </label>
        <div className={styles.speedRow}>
          {SPEEDS.map((speed) => (
            <button
              key={speed.label}
              className={speed.ms === speedMs ? styles.speedActive : styles.speed}
              onClick={() => setSpeedMs(speed.ms)}
            >
              {speed.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="seed">
          Seed
        </label>
        <div className={styles.seedRow}>
          <input
            id="seed"
            className={styles.input}
            value={seedText}
            inputMode="numeric"
            onChange={(event) => setSeedText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applySeed();
            }}
          />
          <button className={styles.ghost} onClick={applySeed} disabled={Number(seedText) === store.seed}>
            Apply
          </button>
        </div>
        <p className={styles.hint}>Same scenario + seed replays the same battle.</p>
      </div>
    </section>
  );
});
