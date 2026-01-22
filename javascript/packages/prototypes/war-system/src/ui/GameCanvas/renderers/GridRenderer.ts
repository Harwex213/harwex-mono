import { GameMap } from '@/types';

export class GridRenderer {
  render(ctx: CanvasRenderingContext2D, map: GameMap): void {
    const { width, height, cellSize } = map;

    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;

    // Draw vertical lines
    for (let x = 0; x <= width; x++) {
      const xPos = x * cellSize;
      ctx.beginPath();
      ctx.moveTo(xPos, 0);
      ctx.lineTo(xPos, height * cellSize);
      ctx.stroke();
    }

    // Draw horizontal lines
    for (let y = 0; y <= height; y++) {
      const yPos = y * cellSize;
      ctx.beginPath();
      ctx.moveTo(0, yPos);
      ctx.lineTo(width * cellSize, yPos);
      ctx.stroke();
    }
  }
}
