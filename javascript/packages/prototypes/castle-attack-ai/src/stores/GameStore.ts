import { makeAutoObservable, runInAction } from 'mobx';
import { Castle } from '../entities/Castle';
import { Unit } from '../entities/Unit';
import { Barrack } from '../entities/Barrack';
import { UnitType, UNIT_STATS } from '../types/UnitType';
import { GameRenderer } from '../renderer/GameRenderer';
import { EnemyAI } from '../ai/EnemyAI';

export class GameStore {
  castles: Castle[] = [];
  units: Unit[] = [];
  barracks: Barrack[] = [];
  gameRunning = false;
  gameLoopId: number | null = null;
  spawnTimer = 0;
  spawnInterval = 20000; // 20 seconds in milliseconds
  renderer: GameRenderer | null = null;
  selectedUnitType: UnitType | null = null;
  gold = 10; // Starting gold
  enemyGold = 10; // Enemy AI starting gold
  enemyAI: EnemyAI;

  // Expose properties for UI
  get timeUntilNextWave(): number {
    return Math.ceil((this.spawnInterval - this.spawnTimer) / 1000);
  }

  constructor() {
    makeAutoObservable(this);
    this.enemyAI = new EnemyAI();
    this.initializeGame();
  }

  initializeGame() {
    // Create left castle (player)
    const leftCastle = new Castle(100, 500, 'player');
    
    // Create right castle (enemy)
    const rightCastle = new Castle(1900, 500, 'enemy');
    
    this.castles = [leftCastle, rightCastle];
    this.units = [];
    this.barracks = [];
  }

  startGame() {
    if (this.gameRunning) return;
    
    this.gameRunning = true;
    this.gameLoop();
  }

  stopGame() {
    this.gameRunning = false;
    if (this.gameLoopId) {
      cancelAnimationFrame(this.gameLoopId);
      this.gameLoopId = null;
    }
  }

  private gameLoop() {
    if (!this.gameRunning) return;

    this.update();
    this.render();
    
    this.gameLoopId = requestAnimationFrame(() => this.gameLoop());
  }

  private update() {
    // Update spawn timer
    this.spawnTimer += 16; // Assuming 60 FPS
    
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnUnitsFromBarracks();
      this.spawnTimer = 0;
    }

    // Update all units
    this.units.forEach(unit => {
      unit.update(this.castles, this.units);
    });

    // Check for dead units and award gold
    const deadUnits = this.units.filter(unit => unit.health <= 0);
    deadUnits.forEach(unit => {
      if (unit.owner === 'enemy') {
        const stats = UNIT_STATS[unit.unitType];
        this.gold += stats.goldReward;
      } else if (unit.owner === 'player') {
        const stats = UNIT_STATS[unit.unitType];
        this.enemyGold += stats.goldReward;
      }
    });

    // Remove dead units
    this.units = this.units.filter(unit => unit.health > 0);

    // Update AI
    this.updateAI();

    // Check win condition
    this.checkWinCondition();
  }

  private render() {
    if (this.renderer) {
      this.renderer.update();
    }
  }

  private spawnUnitsFromBarracks() {
    this.barracks.forEach(barrack => {
      if (barrack.unitType) {
        const unit = new Unit(
          barrack.x + 20,
          barrack.y + 20,
          barrack.unitType,
          barrack.owner
        );
        this.units.push(unit);
        
        // Add gold income for player barracks
        if (barrack.owner === 'player') {
          const stats = UNIT_STATS[barrack.unitType];
          this.gold += stats.incomePerSpawn;
        } else if (barrack.owner === 'enemy') {
          const stats = UNIT_STATS[barrack.unitType];
          this.enemyGold += stats.incomePerSpawn;
        }
      }
    });
  }

  private checkWinCondition() {
    const aliveCastles = this.castles.filter(castle => castle.health > 0);
    if (aliveCastles.length === 1) {
      console.log(`Game Over! ${aliveCastles[0].owner} wins!`);
      this.stopGame();
    }
  }

  addBarrack(x: number, y: number, unitType: UnitType, owner: 'player' | 'enemy') {
    const barrack = new Barrack(x, y, unitType, owner);
    this.barracks.push(barrack);
  }

  removeBarrack(barrack: Barrack) {
    const index = this.barracks.indexOf(barrack);
    if (index > -1) {
      this.barracks.splice(index, 1);
    }
  }

  getPlayerCastle(): Castle | undefined {
    return this.castles.find(castle => castle.owner === 'player');
  }

  getEnemyCastle(): Castle | undefined {
    return this.castles.find(castle => castle.owner === 'enemy');
  }

  getPlayerUnits(): Unit[] {
    return this.units.filter(unit => unit.owner === 'player');
  }

  getEnemyUnits(): Unit[] {
    return this.units.filter(unit => unit.owner === 'enemy');
  }

  setRenderer(renderer: GameRenderer) {
    this.renderer = renderer;
  }

  selectUnitType(unitType: UnitType) {
    this.selectedUnitType = unitType;
  }

  placeBarrack(x: number, y: number, owner: 'player' | 'enemy') {
    if (!this.selectedUnitType) return;
    
    // Check if player has enough gold
    if (owner === 'player') {
      const stats = UNIT_STATS[this.selectedUnitType];
      if (this.gold < stats.cost) {
        console.log(`Not enough gold! Need ${stats.cost}, have ${this.gold}`);
        return;
      }
    }
    
    // Snap to grid
    const gridSize = 50;
    const snappedX = Math.round(x / gridSize) * gridSize;
    const snappedY = Math.round(y / gridSize) * gridSize;
    
    // Check if position is valid (not too close to existing barracks)
    const minDistance = 60;
    const tooClose = this.barracks.some(barrack => {
      const dx = barrack.x - snappedX;
      const dy = barrack.y - snappedY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      return distance < minDistance;
    });
    
    if (tooClose) return;
    
    // Deduct gold cost for player
    if (owner === 'player') {
      const stats = UNIT_STATS[this.selectedUnitType];
      this.gold -= stats.cost;
    }
    
    this.addBarrack(snappedX, snappedY, this.selectedUnitType, owner);
  }

  private updateAI() {
    const gameState = {
      playerGold: this.gold,
      enemyGold: this.enemyGold,
      playerBarracks: this.barracks.filter(b => b.owner === 'player'),
      enemyBarracks: this.barracks.filter(b => b.owner === 'enemy'),
      playerUnits: this.getPlayerUnits().length,
      enemyUnits: this.getEnemyUnits().length,
      playerCastleHealth: this.getPlayerCastle()?.health || 0,
      enemyCastleHealth: this.getEnemyCastle()?.health || 0,
      gameTime: Date.now() - (this.gameStartTime || Date.now())
    };

    this.enemyAI.update(gameState, (x, y, unitType, owner) => {
      this.placeAIBarrack(x, y, unitType, owner);
    });
  }

  private placeAIBarrack(x: number, y: number, unitType: UnitType, owner: 'enemy') {
    const stats = UNIT_STATS[unitType];
    
    // Check if AI has enough gold
    if (this.enemyGold < stats.cost) return;
    
    // Check if position is valid
    const minDistance = 60;
    const tooClose = this.barracks.some(barrack => {
      const dx = barrack.x - x;
      const dy = barrack.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      return distance < minDistance;
    });
    
    if (tooClose) return;
    
    // Deduct gold and place barrack
    this.enemyGold -= stats.cost;
    this.addBarrack(x, y, unitType, owner);
  }

  private gameStartTime: number | null = null;

  startGame() {
    if (this.gameRunning) return;
    
    this.gameRunning = true;
    this.gameStartTime = Date.now();
    this.gameLoop();
  }
}
