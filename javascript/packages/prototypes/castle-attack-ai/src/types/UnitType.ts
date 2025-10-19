export enum UnitType {
  WARRIOR = 'warrior',
  ARCHER = 'archer',
  MAGE = 'mage',
  KNIGHT = 'knight',
  ASSASSIN = 'assassin',
  PALADIN = 'paladin',
  BERSERKER = 'berserker',
  DRAGON = 'dragon'
}

export interface UnitStats {
  health: number;
  damage: number;
  speed: number;
  range: number;
  cost: number;
  color: number;
  size: number;
  goldReward: number;
  incomePerSpawn: number;
}

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  [UnitType.WARRIOR]: {
    health: 100,
    damage: 20,
    speed: 1,
    range: 30,
    cost: 10,
    color: 0x8B4513,
    size: 15,
    goldReward: 5,
    incomePerSpawn: 2
  },
  [UnitType.ARCHER]: {
    health: 60,
    damage: 25,
    speed: 1.2,
    range: 80,
    cost: 15,
    color: 0x228B22,
    size: 12,
    goldReward: 8,
    incomePerSpawn: 3
  },
  [UnitType.MAGE]: {
    health: 40,
    damage: 35,
    speed: 0.8,
    range: 100,
    cost: 25,
    color: 0x8A2BE2,
    size: 10,
    goldReward: 12,
    incomePerSpawn: 5
  },
  [UnitType.KNIGHT]: {
    health: 150,
    damage: 30,
    speed: 0.9,
    range: 35,
    cost: 30,
    color: 0x708090,
    size: 18,
    goldReward: 15,
    incomePerSpawn: 6
  },
  [UnitType.ASSASSIN]: {
    health: 50,
    damage: 40,
    speed: 2.0,
    range: 25,
    cost: 20,
    color: 0x2F4F4F,
    size: 8,
    goldReward: 10,
    incomePerSpawn: 4
  },
  [UnitType.PALADIN]: {
    health: 200,
    damage: 25,
    speed: 0.7,
    range: 40,
    cost: 40,
    color: 0xFFD700,
    size: 20,
    goldReward: 20,
    incomePerSpawn: 8
  },
  [UnitType.BERSERKER]: {
    health: 80,
    damage: 50,
    speed: 1.5,
    range: 30,
    cost: 35,
    color: 0xDC143C,
    size: 16,
    goldReward: 18,
    incomePerSpawn: 7
  },
  [UnitType.DRAGON]: {
    health: 300,
    damage: 60,
    speed: 1.8,
    range: 120,
    cost: 100,
    color: 0xFF4500,
    size: 25,
    goldReward: 50,
    incomePerSpawn: 20
  }
};
