import { Vector2 } from './vector';
import { Order } from './order';

export type UnitType = 'cavalry' | 'infantry' | 'archer' | 'leader';
export type AttackType = 'melee' | 'range';
export type Team = 'player' | 'enemy';

export interface UnitStats {
  hp: number;
  maxHp: number;
  armor: number;
  movement: number;        // units per second
  attackType: AttackType;
  attackRange: number;
  attackDamage: number;
  attackCooldown: number;  // ms
  morale: number;          // 0-100
  discipline: number;      // 0-10
}

export interface Unit {
  id: string;
  type: UnitType;
  team: Team;
  position: Vector2;
  stats: UnitStats;
  currentOrder: Order | null;
  isAlive: boolean;
  lastAttackTime: number;  // timestamp of last attack
}

export interface LeaderUnit extends Unit {
  type: 'leader';
  powerRadius: number;      // radius for giving orders
  observableRadius: number; // radius for movement/attack orders
}
