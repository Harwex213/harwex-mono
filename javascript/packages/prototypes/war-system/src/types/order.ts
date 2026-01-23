import { Vector2 } from './vector';

export type OrderType = 'move' | 'attack' | 'follow';

export interface MoveOrder {
  type: 'move';
  targetPosition: Vector2;
}

export interface AttackOrder {
  type: 'attack';
  targetUnitId: string;
}

export interface FollowOrder {
  type: 'follow';
  leaderUnitId: string;
}

export type Order = MoveOrder | AttackOrder | FollowOrder;
