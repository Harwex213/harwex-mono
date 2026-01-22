import { UnitType, UnitStats } from '@/types';

export const UNIT_STATS: Record<UnitType, Omit<UnitStats, 'hp' | 'morale' | 'discipline'>> = {
  cavalry: {
    maxHp: 80,
    armor: 3,
    movement: 120,
    attackType: 'melee',
    attackRange: 1.5,
    attackDamage: 25,
    attackCooldown: 1000,
  },
  infantry: {
    maxHp: 100,
    armor: 5,
    movement: 60,
    attackType: 'melee',
    attackRange: 1.0,
    attackDamage: 15,
    attackCooldown: 800,
  },
  archer: {
    maxHp: 50,
    armor: 1,
    movement: 70,
    attackType: 'range',
    attackRange: 8.0,
    attackDamage: 20,
    attackCooldown: 1500,
  },
  leader: {
    maxHp: 150,
    armor: 4,
    movement: 100,
    attackType: 'melee',
    attackRange: 1.5,
    attackDamage: 30,
    attackCooldown: 1000,
  },
};

export const LEADER_POWER_RADIUS = 5;      // grid cells
export const LEADER_OBSERVABLE_RADIUS = 12; // grid cells
