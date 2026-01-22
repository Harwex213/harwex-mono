import { Unit } from '@/types';
import { Vector } from '@/core/utils/vector';
import { UnitsStore } from '@/stores/UnitsStore';

export class CombatSystem {
  constructor(private unitsStore: UnitsStore) {}

  update(currentTime: number): void {
    const units = this.unitsStore.aliveUnits;

    for (const unit of units) {
      if (!unit.currentOrder || unit.currentOrder.type !== 'attack') continue;

      this.processAttack(unit, currentTime);
    }
  }

  private processAttack(unit: Unit, currentTime: number): void {
    if (unit.currentOrder?.type !== 'attack') return;

    const target = this.unitsStore.getUnitById(unit.currentOrder.targetUnitId);

    // Target is dead or invalid
    if (!target || !target.isAlive) {
      unit.currentOrder = null;
      return;
    }

    const distance = Vector.distance(unit.position, target.position);

    // Not in range - move closer
    if (distance > unit.stats.attackRange) {
      // Convert to temporary move order towards target
      unit.position = Vector.moveTowards(
        unit.position,
        target.position,
        unit.stats.movement * 0.016 // Assuming ~60fps
      );
      return;
    }

    // Check attack cooldown
    const timeSinceLastAttack = currentTime - unit.lastAttackTime;
    if (timeSinceLastAttack < unit.stats.attackCooldown) {
      return;
    }

    // Execute attack
    this.dealDamage(unit, target);
    unit.lastAttackTime = currentTime;

    // Check if target died
    if (target.stats.hp <= 0) {
      this.unitsStore.killUnit(target);
      unit.currentOrder = null;
    }
  }

  private dealDamage(attacker: Unit, target: Unit): void {
    const baseDamage = attacker.stats.attackDamage;
    const damageReduction = target.stats.armor * 0.5;
    const actualDamage = Math.max(1, baseDamage - damageReduction);

    target.stats.hp = Math.max(0, target.stats.hp - actualDamage);
  }
}
