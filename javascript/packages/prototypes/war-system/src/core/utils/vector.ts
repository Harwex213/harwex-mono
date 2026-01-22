import { Vector2 } from '@/types';

export const Vector = {
  create(x: number, y: number): Vector2 {
    return { x, y };
  },

  distance(a: Vector2, b: Vector2): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  },

  subtract(a: Vector2, b: Vector2): Vector2 {
    return { x: a.x - b.x, y: a.y - b.y };
  },

  add(a: Vector2, b: Vector2): Vector2 {
    return { x: a.x + b.x, y: a.y + b.y };
  },

  scale(v: Vector2, scalar: number): Vector2 {
    return { x: v.x * scalar, y: v.y * scalar };
  },

  length(v: Vector2): number {
    return Math.sqrt(v.x * v.x + v.y * v.y);
  },

  normalize(v: Vector2): Vector2 {
    const len = Vector.length(v);
    if (len === 0) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
  },

  moveTowards(from: Vector2, to: Vector2, maxDistance: number): Vector2 {
    const diff = Vector.subtract(to, from);
    const distance = Vector.length(diff);
    
    if (distance <= maxDistance) {
      return to;
    }
    
    const normalized = Vector.normalize(diff);
    return Vector.add(from, Vector.scale(normalized, maxDistance));
  },

  equals(a: Vector2, b: Vector2, epsilon = 0.01): boolean {
    return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
  },
};
