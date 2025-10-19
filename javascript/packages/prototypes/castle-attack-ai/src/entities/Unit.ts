import { makeAutoObservable } from 'mobx';
import { UnitType, UNIT_STATS } from '../types/UnitType';
import { Castle } from './Castle';

export class Unit {
  x: number;
  y: number;
  unitType: UnitType;
  owner: 'player' | 'enemy';
  health: number;
  maxHealth: number;
  damage: number;
  speed: number;
  range: number;
  size: number;
  color: number;
  lastAttackTime = 0;
  attackCooldown = 1000; // 1 second

  constructor(x: number, y: number, unitType: UnitType, owner: 'player' | 'enemy') {
    this.x = x;
    this.y = y;
    this.unitType = unitType;
    this.owner = owner;
    
    const stats = UNIT_STATS[unitType];
    this.health = stats.health;
    this.maxHealth = stats.health;
    this.damage = stats.damage;
    this.speed = stats.speed;
    this.range = stats.range;
    this.size = stats.size;
    this.color = stats.color;
    
    makeAutoObservable(this);
  }

  update(castles: Castle[], units: Unit[]) {
    if (this.health <= 0) return;

    // Find target (enemy castle or enemy unit)
    const target = this.findTarget(castles, units);
    if (!target) return;

    const distance = this.getDistanceToTarget(target);
    
    if (distance <= this.range) {
      // Attack if in range
      this.attack(target);
    } else {
      // Move towards target
      this.moveTowardsTarget(target);
    }
  }

  private findTarget(castles: Castle[], units: Unit[]): Castle | Unit | null {
    // Priority: enemy units first (for combat), then enemy castles
    const enemyUnits = units.filter(unit => unit.owner !== this.owner && unit.health > 0);
    if (enemyUnits.length > 0) {
      // Find closest enemy unit within a reasonable distance
      let closestUnit = null;
      let closestDistance = Infinity;
      const maxUnitTargetDistance = 200; // Only target units within 200 pixels
      
      for (const unit of enemyUnits) {
        const distance = this.getDistanceToTarget(unit);
        if (distance < closestDistance && distance <= maxUnitTargetDistance) {
          closestDistance = distance;
          closestUnit = unit;
        }
      }
      
      if (closestUnit) {
        return closestUnit;
      }
    }

    // If no enemy units nearby, target enemy castle
    const enemyCastles = castles.filter(castle => castle.owner !== this.owner && castle.isAlive());
    if (enemyCastles.length > 0) {
      return enemyCastles[0];
    }

    return null;
  }

  private getDistanceToTarget(target: Castle | Unit): number {
    const targetX = 'getCenterX' in target ? target.getCenterX() : target.x;
    const targetY = 'getCenterY' in target ? target.getCenterY() : target.y;
    
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private attack(target: Castle | Unit) {
    const currentTime = Date.now();
    if (currentTime - this.lastAttackTime < this.attackCooldown) return;

    this.lastAttackTime = currentTime;
    
    if ('takeDamage' in target) {
      target.takeDamage(this.damage);
    } else {
      target.health = Math.max(0, target.health - this.damage);
    }
  }

  private moveTowardsTarget(target: Castle | Unit) {
    const targetX = 'getCenterX' in target ? target.getCenterX() : target.x;
    const targetY = 'getCenterY' in target ? target.getCenterY() : target.y;
    
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > 0) {
      const moveX = (dx / distance) * this.speed;
      const moveY = (dy / distance) * this.speed;
      
      this.x += moveX;
      this.y += moveY;
    }
  }

  takeDamage(damage: number) {
    this.health = Math.max(0, this.health - damage);
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  getCenterX(): number {
    return this.x + this.size / 2;
  }

  getCenterY(): number {
    return this.y + this.size / 2;
  }
}
