import { GameStore } from '@/stores/GameStore';
import { UnitsStore } from '@/stores/UnitsStore';
import { MovementSystem } from './systems/MovementSystem';
import { CombatSystem } from './systems/CombatSystem';
import { AIController } from './systems/AIController';

export class GameLoop {
  private lastTime = 0;
  private animationFrameId: number | null = null;

  private movementSystem: MovementSystem;
  private combatSystem: CombatSystem;
  private aiController: AIController;

  constructor(
    private gameStore: GameStore,
    private unitsStore: UnitsStore
  ) {
    this.movementSystem = new MovementSystem(unitsStore);
    this.combatSystem = new CombatSystem(unitsStore);
    this.aiController = new AIController(unitsStore);
  }

  start(): void {
    this.lastTime = performance.now();
    this.tick(this.lastTime);
  }

  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private tick = (currentTime: number): void => {
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    if (this.gameStore.isPlaying) {
      // 1. Process AI decisions
      this.aiController.update();

      // 2. Process movement
      this.movementSystem.update(deltaTime);

      // 3. Resolve combat
      this.combatSystem.update(currentTime);

      // 4. Check win/lose conditions
      this.checkGameConditions();
    }

    // Continue the loop
    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  private checkGameConditions(): void {
    const playerUnits = this.unitsStore.playerUnits;
    const enemyUnits = this.unitsStore.enemyUnits;

    if (playerUnits.length === 0) {
      this.gameStore.lose();
    } else if (enemyUnits.length === 0) {
      this.gameStore.win();
    }
  }
}
