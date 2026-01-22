import { Order, LeaderUnit, Unit, Vector2 } from '@/types';
import { Vector } from '@/core/utils/vector';
import { Geometry } from '@/core/utils/geometry';
import { UnitsStore } from '@/stores/UnitsStore';

export class OrderSystem {
  constructor(private unitsStore: UnitsStore) {}

  issueOrderToUnitsInRange(leader: LeaderUnit, order: Order): void {
    const playerUnits = this.unitsStore.playerUnits;

    for (const unit of playerUnits) {
      if (unit.id === leader.id) continue; // Don't give orders to self
      if (!this.isUnitInPowerRadius(unit, leader)) continue;

      // Validate observable radius for move/attack orders
      if (order.type === 'move') {
        if (!Geometry.isInRadius(order.targetPosition, leader.position, leader.observableRadius)) {
          continue;
        }
      } else if (order.type === 'attack') {
        const target = this.unitsStore.getUnitById(order.targetUnitId);
        if (!target || !Geometry.isInRadius(target.position, leader.position, leader.observableRadius)) {
          continue;
        }
      }

      unit.currentOrder = order;
    }
  }

  issueOrderToLeader(leader: LeaderUnit, order: Order): void {
    leader.currentOrder = order;
  }

  private isUnitInPowerRadius(unit: Unit, leader: LeaderUnit): boolean {
    return Geometry.isInRadius(unit.position, leader.position, leader.powerRadius);
  }
}
