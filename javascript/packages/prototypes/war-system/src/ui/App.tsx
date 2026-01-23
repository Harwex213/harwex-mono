import { observer } from 'mobx-react-lite';
import { useMemo, useEffect, useRef } from 'react';
import { GameStore } from '@/stores/GameStore';
import { MapStore } from '@/stores/MapStore';
import { UnitsStore } from '@/stores/UnitsStore';
import { SelectionStore } from '@/stores/SelectionStore';
import { GameLoop } from '@/core/GameLoop';
import { OrderSystem } from '@/core/systems/OrderSystem';
import { GameCanvas } from './GameCanvas/GameCanvas';
import { HUD } from './HUD/HUD';
import styles from './app.module.css';

export const App = observer(() => {
  const gameStore = useMemo(() => new GameStore(), []);
  const mapStore = useMemo(() => new MapStore(), []);
  const unitsStore = useMemo(() => new UnitsStore(), []);
  const selectionStore = useMemo(() => new SelectionStore(), []);
  const orderSystem = useMemo(() => new OrderSystem(unitsStore), [unitsStore]);
  
  const gameLoopRef = useRef<GameLoop | null>(null);

  useEffect(() => {
    // Initialize units
    unitsStore.initializeUnits();

    // Create and start game loop
    const gameLoop = new GameLoop(gameStore, unitsStore);
    gameLoopRef.current = gameLoop;
    gameLoop.start();

    // Keyboard controls
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (gameStore.isPlaying) {
          gameStore.pause();
        } else if (gameStore.isPaused) {
          gameStore.play();
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);

    return () => {
      gameLoop.stop();
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [gameStore, unitsStore]);

  const handlePlay = () => {
    gameStore.play();
  };

  const handlePause = () => {
    gameStore.pause();
  };

  const handleRestart = () => {
    unitsStore.initializeUnits();
    selectionStore.clearSelection();
    gameStore.restart();
  };

  return (
    <div className={styles.app}>
      <GameCanvas
        mapStore={mapStore}
        unitsStore={unitsStore}
        selectionStore={selectionStore}
        orderSystem={orderSystem}
      />
      <HUD
        gameStore={gameStore}
        unitsStore={unitsStore}
        selectionStore={selectionStore}
        onPlay={handlePlay}
        onPause={handlePause}
        onRestart={handleRestart}
      />
    </div>
  );
});
