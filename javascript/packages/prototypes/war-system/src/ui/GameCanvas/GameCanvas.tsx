import { observer } from 'mobx-react-lite';
import { useRef, useEffect } from 'react';
import { MapStore } from '@/stores/MapStore';
import { UnitsStore } from '@/stores/UnitsStore';
import { SelectionStore } from '@/stores/SelectionStore';
import { GridRenderer } from './renderers/GridRenderer';
import { UnitRenderer } from './renderers/UnitRenderer';
import { UIRenderer } from './renderers/UIRenderer';
import { OrderSystem } from '@/core/systems/OrderSystem';
import { LeaderUnit } from '@/types';
import styles from './gameCanvas.module.css';

interface GameCanvasProps {
  mapStore: MapStore;
  unitsStore: UnitsStore;
  selectionStore: SelectionStore;
  orderSystem: OrderSystem;
}

export const GameCanvas = observer(({
  mapStore,
  unitsStore,
  selectionStore,
  orderSystem,
}: GameCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRenderer = useRef(new GridRenderer());
  const unitRenderer = useRef(new UnitRenderer(mapStore.map));
  const uiRenderer = useRef(new UIRenderer(mapStore.map));

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Render grid
      gridRenderer.current.render(ctx, mapStore.map);

      // Render UI elements
      uiRenderer.current.renderHoveredCell(ctx, selectionStore.hoveredCell);

      // Render units
      unitRenderer.current.render(ctx, unitsStore.aliveUnits, selectionStore.selectedUnitId);

      // Render order visualization
      const selectedUnit = selectionStore.selectedUnitId
        ? unitsStore.getUnitById(selectionStore.selectedUnitId)
        : null;
      uiRenderer.current.renderOrderVisualization(ctx, selectedUnit || null, selectionStore.hoveredCell);

      requestAnimationFrame(render);
    };

    render();
  }, [mapStore.map, unitsStore, selectionStore]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / mapStore.map.cellSize);
    const y = Math.floor((e.clientY - rect.top) / mapStore.map.cellSize);

    selectionStore.setHoveredCell({ x, y });
  };

  const handleMouseLeave = () => {
    selectionStore.setHoveredCell(null);
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const gridX = (e.clientX - rect.left) / mapStore.map.cellSize;
    const gridY = (e.clientY - rect.top) / mapStore.map.cellSize;

    // Try to select a leader unit
    const clickedUnit = unitsStore.playerUnits.find((unit) => {
      const dx = unit.position.x - gridX;
      const dy = unit.position.y - gridY;
      return Math.sqrt(dx * dx + dy * dy) < 0.5 && unit.type === 'leader';
    });

    if (clickedUnit) {
      selectionStore.selectUnit(clickedUnit.id);
    } else {
      selectionStore.clearSelection();
    }
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    if (!selectionStore.selectedUnitId) return;

    const leader = unitsStore.getUnitById(selectionStore.selectedUnitId) as LeaderUnit | undefined;
    if (!leader || leader.type !== 'leader') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const gridX = (e.clientX - rect.left) / mapStore.map.cellSize;
    const gridY = (e.clientY - rect.top) / mapStore.map.cellSize;

    // Check if clicking on an enemy unit
    const clickedUnit = unitsStore.enemyUnits.find((unit) => {
      const dx = unit.position.x - gridX;
      const dy = unit.position.y - gridY;
      return Math.sqrt(dx * dx + dy * dy) < 0.5;
    });

    if (clickedUnit) {
      // Issue attack order
      const attackOrder = { type: 'attack' as const, targetUnitId: clickedUnit.id };
      orderSystem.issueOrderToUnitsInRange(leader, attackOrder);
      orderSystem.issueOrderToLeader(leader, attackOrder);
    } else {
      // Issue move order
      const moveOrder = { type: 'move' as const, targetPosition: { x: gridX, y: gridY } };
      orderSystem.issueOrderToUnitsInRange(leader, moveOrder);
      orderSystem.issueOrderToLeader(leader, moveOrder);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      width={mapStore.canvasWidth}
      height={mapStore.canvasHeight}
      className={styles.canvas}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    />
  );
});
