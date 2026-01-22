import { Unit } from '@/types';
import { Vector } from '@/core/utils/vector';
import { UnitsStore } from '@/stores/UnitsStore';

export class AIController {
  constructor(private unitsStore: UnitsStore) {}

  update(): void {
    const enemyUnits = this.unitsStore.enemyUnits;
    const playerUnits = this.unitsStore.playerUnits;

    if (playerUnits.length === 0) return;

    for (const enemy of enemyUnits) {
      // Simple aggressive AI: find closest player unit and attack
      const closestPlayer = this.findClosestUnit(enemy, playerUnits);
      
      if (closestPlayer) {
        enemy.currentOrder = {
          type: 'attack',
          targetUnitId: closestPlayer.id,
        };
      }
    }
  }

  private findClosestUnit(from: Unit, targets: Unit[]): Unit | null {
    if (targets.length === 0) return null;

    let closest = targets[0];
    let minDistance = Vector.distance(from.position, closest.position);

    for (let i = 1; i < targets.length; i++) {
      const distance = Vector.distance(from.position, targets[i].position);
      if (distance < minDistance) {
        minDistance = distance;
        closest = targets[i];
      }
    }

    return closest;
  }
}
