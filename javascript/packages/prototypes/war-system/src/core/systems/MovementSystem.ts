import { Unit, LeaderUnit } from '@/types';
import { Vector } from '@/core/utils/vector';
import { UnitsStore } from '@/stores/UnitsStore';

export class MovementSystem {
  constructor(private unitsStore: UnitsStore) {}

  update(deltaTime: number): void {
    const units = this.unitsStore.aliveUnits;
    const deltaSeconds = deltaTime / 1000;

    for (const unit of units) {
      if (!unit.currentOrder) continue;

      if (unit.currentOrder.type === 'move') {
        this.processMove(unit, deltaSeconds);
      } else if (unit.currentOrder.type === 'follow') {
        this.processFollow(unit, deltaSeconds);
      }
    }
  }

  private processMove(unit: Unit, deltaSeconds: number): void {
    if (unit.currentOrder?.type !== 'move') return;

    const target = unit.currentOrder.targetPosition;
    const distance = Vector.distance(unit.position, target);

    // Arrived at target
    if (distance < 0.5) {
      unit.currentOrder = null;
      return;
    }

    // Move towards target
    const maxDistance = unit.stats.movement * deltaSeconds;
    unit.position = Vector.moveTowards(unit.position, target, maxDistance);
  }

  private processFollow(unit: Unit, deltaSeconds: number): void {
    if (unit.currentOrder?.type !== 'follow') return;

    const leader = this.unitsStore.getUnitById(unit.currentOrder.leaderUnitId) as LeaderUnit | undefined;
    
    if (!leader || !leader.isAlive) {
      unit.currentOrder = null;
      return;
    }

    // Calculate follow position (slight offset to avoid stacking)
    const offset = {
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
    };
    const targetPosition = Vector.add(leader.position, offset);
    const distance = Vector.distance(unit.position, targetPosition);

    // Maintain minimum distance from leader
    if (distance > 3) {
      const maxDistance = unit.stats.movement * deltaSeconds;
      unit.position = Vector.moveTowards(unit.position, targetPosition, maxDistance);
    }
  }
}
