import { observer } from 'mobx-react-lite';
import { GameStore } from '@/stores/GameStore';
import { UnitsStore } from '@/stores/UnitsStore';
import { SelectionStore } from '@/stores/SelectionStore';
import styles from './hud.module.css';

interface HUDProps {
  gameStore: GameStore;
  unitsStore: UnitsStore;
  selectionStore: SelectionStore;
  onPlay: () => void;
  onPause: () => void;
  onRestart: () => void;
}

export const HUD = observer(({
  gameStore,
  unitsStore,
  selectionStore,
  onPlay,
  onPause,
  onRestart,
}: HUDProps) => {
  const selectedUnit = selectionStore.selectedUnitId
    ? unitsStore.getUnitById(selectionStore.selectedUnitId)
    : null;

  const getStatusClass = () => {
    switch (gameStore.state) {
      case 'playing': return styles.statusPlaying;
      case 'paused': return styles.statusPaused;
      case 'won': return styles.statusWon;
      case 'lost': return styles.statusLost;
      default: return '';
    }
  };

  const getStatusText = () => {
    switch (gameStore.state) {
      case 'playing': return 'Battle in Progress';
      case 'paused': return 'Paused';
      case 'won': return 'Victory!';
      case 'lost': return 'Defeat';
      default: return '';
    }
  };

  return (
    <div className={styles.hud}>
      <div className={styles.title}>War System</div>

      <div className={`${styles.gameStatus} ${getStatusClass()}`}>
        {getStatusText()}
      </div>

      <div className={styles.section}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Player Units:</span>
          <span className={styles.statValue} style={{ color: '#3b82f6' }}>
            {unitsStore.playerUnits.length}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Enemy Units:</span>
          <span className={styles.statValue} style={{ color: '#ef4444' }}>
            {unitsStore.enemyUnits.length}
          </span>
        </div>
      </div>

      {selectedUnit && (
        <div className={styles.section}>
          <div className={styles.label}>Selected Unit</div>
          <div className={styles.unitInfo}>
            <div className={styles.unitType}>
              {selectedUnit.type} ({selectedUnit.team})
            </div>
            <div className={styles.hpBar}>
              <div
                className={styles.hpFill}
                style={{
                  width: `${(selectedUnit.stats.hp / selectedUnit.stats.maxHp) * 100}%`,
                  backgroundColor:
                    selectedUnit.stats.hp / selectedUnit.stats.maxHp > 0.5
                      ? '#22c55e'
                      : selectedUnit.stats.hp / selectedUnit.stats.maxHp > 0.25
                      ? '#f59e0b'
                      : '#ef4444',
                }}
              />
            </div>
            <div className={styles.hpText}>
              {Math.round(selectedUnit.stats.hp)} / {selectedUnit.stats.maxHp} HP
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Armor:</span>
              <span className={styles.statValue}>{selectedUnit.stats.armor}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Damage:</span>
              <span className={styles.statValue}>{selectedUnit.stats.attackDamage}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Range:</span>
              <span className={styles.statValue}>{selectedUnit.stats.attackRange}</span>
            </div>
          </div>
        </div>
      )}

      <div className={styles.section}>
        {gameStore.isPaused && !gameStore.isGameOver && (
          <button className={`${styles.button} ${styles.playButton}`} onClick={onPlay}>
            Start Battle
          </button>
        )}
        {gameStore.isPlaying && (
          <button className={`${styles.button} ${styles.pauseButton}`} onClick={onPause}>
            Pause
          </button>
        )}
        <button className={`${styles.button} ${styles.restartButton}`} onClick={onRestart}>
          Restart
        </button>
      </div>

      <div className={styles.section}>
        <div className={styles.label}>Controls</div>
        <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: '1.6' }}>
          • Click leader to select<br />
          • Right-click to move/attack<br />
          • Space to pause
        </div>
      </div>
    </div>
  );
});
