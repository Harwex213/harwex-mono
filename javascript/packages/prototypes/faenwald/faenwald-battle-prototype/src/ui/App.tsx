import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { BattleStore } from '@/model/battle-store';
import { coordKey } from '@/model/board';
import type { Axial } from '@/model/types';
import { BattleStoreContext, useBattleStore } from './store-context';
import { HexGrid } from './components/HexGrid';
import { UnitCard } from './components/UnitCard';
import { ActionBar } from './components/ActionBar';
import { TurnTracker } from './components/TurnTracker';
import { DamagePreview } from './components/DamagePreview';
import { BattleResult } from './components/BattleResult';
import { PlaybackControls } from './components/PlaybackControls';
import { CheatSheet } from './components/CheatSheet';
import styles from './App.module.css';

/** Cursor-anchored damage preview for the hovered attack target (item 13). */
interface HoverPreview {
  defenderId: string;
  x: number;
  y: number;
}

const Battle = observer(() => {
  const store = useBattleStore();
  const [hover, setHover] = useState<HoverPreview | null>(null);
  const [showCheatSheet, setShowCheatSheet] = useState(false);

  useEffect(() => {
    void store.loadScenarios();
    void store.load();
  }, [store]);

  if (store.status === 'loading' || store.status === 'idle') {
    return <div className={styles.state}>Marshalling the armies…</div>;
  }

  if (store.status === 'error') {
    return (
      <div className={styles.state}>
        <p>Failed to load the battle: {store.error}</p>
        <button className={styles.button} onClick={() => void store.reset()}>
          Retry
        </button>
      </div>
    );
  }

  const selected = store.selectedUnit;
  // Once a side has lost the field (§11.4) the battle is over: no unit may act,
  // so the board offers no move/attack affordances and the result screen shows.
  const over = store.isBattleOver;
  // The unit whose turn it is (§6.1) is the one the UI lets you command; its
  // front hexes and attackable enemies are the only affordances on the board.
  const actor = over ? null : store.activeUnit;
  const moveTargetKeys = new Set(
    actor ? store.moveTargets(actor).map((coord) => coordKey(coord)) : [],
  );
  const attackableIds = new Set(
    actor ? store.targetableEnemies(actor).map((unit) => unit.id) : [],
  );

  const handleMoveTo = (coord: Axial) => {
    if (actor) store.moveUnit(actor.id, coord);
  };
  const handleAttack = (defenderId: string) => {
    if (actor) store.applyAttack(actor.id, defenderId);
    setHover(null);
  };
  const handleHoverTarget = (defenderId: string | null, x: number, y: number) => {
    setHover(defenderId ? { defenderId, x, y } : null);
  };

  const hoveredDefender = hover ? store.units.find((u) => u.id === hover.defenderId) ?? null : null;
  const hoverResult = actor && hover ? store.previewAttack(actor.id, hover.defenderId) : null;

  // Reactive-layer notices (§8, §11.3): opportunity attacks from the last move and any ruler fate.
  const opportunityNotices = store.lastOpportunityAttacks.map(
    (op) =>
      `⚡ ${op.threatName} struck ${op.moverName} ${op.kind === 'melee' ? 'in passing' : `(${op.kind} fire)`} — −${op.physical} HP, −${op.morale} morale (§8)`,
  );
  const fateLabel: Record<string, string> = { killed: 'was slain', captured: 'was captured', fled: 'fled the field' };
  const rulerNotices = (['blue', 'red'] as const)
    .filter((side) => store.rulerFate[side])
    .map((side) => `👑 The ${side} ruler ${fateLabel[store.rulerFate[side]!]} (§11.3)`);
  const notices = [...rulerNotices, ...opportunityNotices];

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div>
          <h1 className={styles.title}>{store.name}</h1>
          <p className={styles.subtitle}>
            Turn {store.turn} · {store.survivors('blue').length} blue · {store.survivors('red').length} red
            — {over
              ? 'battle over — see the result'
              : actor
                ? `${actor.name} acts (move or attack, then “Next unit”)`
                : 'battle over'}
          </p>
        </div>
        <div className={styles.actions}>
          <button className={styles.buttonGhost} onClick={() => setShowCheatSheet(true)}>
            📖 Cheat-sheet
          </button>
        </div>
      </header>

      {notices.length > 0 && (
        <div className={styles.banner}>
          {notices.map((notice) => (
            <div key={notice}>{notice}</div>
          ))}
        </div>
      )}

      <main className={styles.field}>
        <div className={styles.boardWrap}>
          {store.board && (
            <HexGrid
              board={store.board}
              units={store.units}
              selectedUnitId={store.selectedUnitId}
              moveTargetKeys={moveTargetKeys}
              attackableIds={attackableIds}
              onSelectUnit={(id) => store.select(id)}
              onMoveTo={handleMoveTo}
              onAttack={handleAttack}
              onHoverTarget={handleHoverTarget}
            />
          )}
        </div>

        <div className={styles.panel}>
          <PlaybackControls store={store} />
          {over ? (
            <BattleResult store={store} />
          ) : (
            <>
              <TurnTracker store={store} />
              {actor && <ActionBar unit={actor} store={store} />}
            </>
          )}
          {selected && store.board ? (
            <UnitCard unit={selected} board={store.board} />
          ) : (
            <p className={styles.hint}>Click a unit token on the field to inspect it.</p>
          )}
        </div>
      </main>

      {hoveredDefender && hoverResult && actor && (
        <div
          style={{
            position: 'fixed',
            left: hover!.x + 16,
            top: hover!.y + 16,
            zIndex: 20,
            pointerEvents: 'none',
          }}
        >
          <DamagePreview
            attackerName={actor.name}
            defenderName={hoveredDefender.name}
            result={hoverResult}
          />
        </div>
      )}

      {showCheatSheet && <CheatSheet onClose={() => setShowCheatSheet(false)} />}
    </div>
  );
});

export const App = () => {
  const store = useMemo(() => new BattleStore(), []);

  return (
    <BattleStoreContext.Provider value={store}>
      <Battle />
    </BattleStoreContext.Provider>
  );
};
