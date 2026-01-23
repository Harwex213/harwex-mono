import { makeAutoObservable } from 'mobx';
import { Unit, LeaderUnit, UnitType, Team, Vector2 } from '@/types';
import { UNIT_STATS, LEADER_POWER_RADIUS, LEADER_OBSERVABLE_RADIUS } from '@/config/unitStats';
import { GAME_CONFIG } from '@/config/gameConfig';

let unitIdCounter = 0;

export class UnitsStore {
  units: Unit[] = [];

  constructor() {
    makeAutoObservable(this);
  }

  createUnit(type: UnitType, team: Team, position: Vector2): Unit {
    const baseStats = UNIT_STATS[type];
    const unit: Unit = {
      id: `unit-${unitIdCounter++}`,
      type,
      team,
      position,
      stats: {
        ...baseStats,
        hp: baseStats.maxHp,
        morale: 100,
        discipline: 5,
      },
      currentOrder: null,
      isAlive: true,
      lastAttackTime: 0,
    };

    if (type === 'leader') {
      const leaderUnit: LeaderUnit = {
        ...unit,
        type: 'leader',
        powerRadius: LEADER_POWER_RADIUS,
        observableRadius: LEADER_OBSERVABLE_RADIUS,
      };
      this.units.push(leaderUnit);
      return leaderUnit;
    }

    this.units.push(unit);
    return unit;
  }

  initializeUnits(): void {
    this.units = [];
    const { player, enemy } = GAME_CONFIG.initialUnits;
    const { playerX, enemyX, spreadY } = GAME_CONFIG.spawn;

    let yOffset = 10;

    // Create player units
    if (player.leader) {
      this.createUnit('leader', 'player', { x: playerX, y: 15 });
    }

    for (let i = 0; i < player.cavalry; i++) {
      this.createUnit('cavalry', 'player', { x: playerX + 2, y: yOffset });
      yOffset += spreadY;
    }

    for (let i = 0; i < player.infantry; i++) {
      this.createUnit('infantry', 'player', { x: playerX + 4, y: yOffset });
      yOffset += spreadY;
    }

    for (let i = 0; i < player.archer; i++) {
      this.createUnit('archer', 'player', { x: playerX + 6, y: yOffset });
      yOffset += spreadY;
    }

    // Create enemy units
    yOffset = 5;

    for (let i = 0; i < enemy.cavalry; i++) {
      this.createUnit('cavalry', 'enemy', { x: enemyX, y: yOffset });
      yOffset += spreadY;
    }

    for (let i = 0; i < enemy.infantry; i++) {
      this.createUnit('infantry', 'enemy', { x: enemyX - 2, y: yOffset });
      yOffset += spreadY;
    }

    for (let i = 0; i < enemy.archer; i++) {
      this.createUnit('archer', 'enemy', { x: enemyX - 4, y: yOffset });
      yOffset += spreadY;
    }
  }

  get playerUnits(): Unit[] {
    return this.units.filter((u) => u.team === 'player' && u.isAlive);
  }

  get enemyUnits(): Unit[] {
    return this.units.filter((u) => u.team === 'enemy' && u.isAlive);
  }

  get aliveUnits(): Unit[] {
    return this.units.filter((u) => u.isAlive);
  }

  getUnitById(id: string): Unit | undefined {
    return this.units.find((u) => u.id === id);
  }

  getPlayerLeader(): LeaderUnit | undefined {
    return this.playerUnits.find((u) => u.type === 'leader') as LeaderUnit | undefined;
  }

  killUnit(unit: Unit): void {
    unit.isAlive = false;
    unit.currentOrder = null;
  }
}
