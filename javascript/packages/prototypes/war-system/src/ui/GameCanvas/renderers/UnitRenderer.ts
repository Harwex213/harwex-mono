import { Unit, LeaderUnit, GameMap } from '@/types';

export class UnitRenderer {
  constructor(private map: GameMap) {}

  render(ctx: CanvasRenderingContext2D, units: Unit[], selectedUnitId: string | null): void {
    for (const unit of units) {
      if (!unit.isAlive) continue;

      const x = unit.position.x * this.map.cellSize;
      const y = unit.position.y * this.map.cellSize;
      const color = unit.team === 'player' ? '#3b82f6' : '#ef4444';

      // Draw unit based on type
      if (unit.type === 'leader') {
        this.drawLeader(ctx, unit as LeaderUnit, x, y, color);
      } else if (unit.type === 'cavalry') {
        this.drawCavalry(ctx, x, y, color);
      } else if (unit.type === 'infantry') {
        this.drawInfantry(ctx, x, y, color);
      } else if (unit.type === 'archer') {
        this.drawArcher(ctx, x, y, color);
      }

      // Draw HP bar
      this.drawHealthBar(ctx, unit, x, y);

      // Highlight selected unit
      if (unit.id === selectedUnitId) {
        this.drawSelection(ctx, x, y);
      }
    }
  }

  private drawLeader(ctx: CanvasRenderingContext2D, leader: LeaderUnit, x: number, y: number, color: string): void {
    const size = 12;

    // Draw power radius
    ctx.strokeStyle = color + '40';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, leader.powerRadius * this.map.cellSize, 0, Math.PI * 2);
    ctx.stroke();

    // Draw observable radius
    ctx.strokeStyle = color + '20';
    ctx.beginPath();
    ctx.arc(x, y, leader.observableRadius * this.map.cellSize, 0, Math.PI * 2);
    ctx.stroke();

    // Draw leader triangle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x - size, y + size);
    ctx.lineTo(x + size, y + size);
    ctx.closePath();
    ctx.fill();
  }

  private drawCavalry(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    const size = 6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x - size, y + size);
    ctx.lineTo(x + size, y + size);
    ctx.closePath();
    ctx.fill();
  }

  private drawInfantry(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    const size = 6;
    ctx.fillStyle = color;
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
  }

  private drawArcher(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    const radius = 6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawHealthBar(ctx: CanvasRenderingContext2D, unit: Unit, x: number, y: number): void {
    const barWidth = 20;
    const barHeight = 3;
    const offsetY = -15;

    const healthPercent = unit.stats.hp / unit.stats.maxHp;

    // Background
    ctx.fillStyle = '#333';
    ctx.fillRect(x - barWidth / 2, y + offsetY, barWidth, barHeight);

    // Health
    ctx.fillStyle = healthPercent > 0.5 ? '#22c55e' : healthPercent > 0.25 ? '#f59e0b' : '#ef4444';
    ctx.fillRect(x - barWidth / 2, y + offsetY, barWidth * healthPercent, barHeight);
  }

  private drawSelection(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.stroke();
  }
}
