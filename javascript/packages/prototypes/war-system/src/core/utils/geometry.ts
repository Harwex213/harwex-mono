import { Vector2 } from '@/types';
import { Vector } from './vector';

export const Geometry = {
  isInRadius(position: Vector2, center: Vector2, radius: number): boolean {
    return Vector.distance(position, center) <= radius;
  },

  getAngle(from: Vector2, to: Vector2): number {
    const diff = Vector.subtract(to, from);
    return Math.atan2(diff.y, diff.x);
  },

  rotatePoint(point: Vector2, center: Vector2, angle: number): Vector2 {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    
    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos,
    };
  },
};
