import { Vector2, GameMap, Unit } from '@/types';

export class UIRenderer {
  constructor(private map: GameMap) {}

  renderOrderVisualization(
    ctx: CanvasRenderingContext2D,
    selectedUnit: Unit | null,
    hoveredCell: Vector2 | null
  ): void {
    if (!selectedUnit || !hoveredCell) return;

    const fromX = selectedUnit.position.x * this.map.cellSize;
    const fromY = selectedUnit.position.y * this.map.cellSize;
    const toX = hoveredCell.x * this.map.cellSize;
    const toY = hoveredCell.y * this.map.cellSize;

    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  renderHoveredCell(ctx: CanvasRenderingContext2D, hoveredCell: Vector2 | null): void {
    if (!hoveredCell) return;

    const x = hoveredCell.x * this.map.cellSize;
    const y = hoveredCell.y * this.map.cellSize;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(x - this.map.cellSize / 2, y - this.map.cellSize / 2, this.map.cellSize, this.map.cellSize);
  }
}
