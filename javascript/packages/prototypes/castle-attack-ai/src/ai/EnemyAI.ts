import { UnitType, UNIT_STATS } from '../types/UnitType';
import { Barrack } from '../entities/Barrack';

export interface GameState {
  playerGold: number;
  enemyGold: number;
  playerBarracks: Barrack[];
  enemyBarracks: Barrack[];
  playerUnits: number;
  enemyUnits: number;
  playerCastleHealth: number;
  enemyCastleHealth: number;
  gameTime: number;
}

export class EnemyAI {
  private gameState: GameState;
  private lastDecisionTime = 0;
  private decisionInterval = 5000; // Make decisions every 5 seconds
  private strategyPhase: 'early' | 'mid' | 'late' = 'early';
  private aggressionLevel = 0.5; // 0 = defensive, 1 = aggressive
  private economicFocus = 0.5; // 0 = military, 1 = economic

  constructor() {
    this.gameState = this.createInitialGameState();
  }

  update(gameState: GameState, placeBarrack: (x: number, y: number, unitType: UnitType, owner: 'enemy') => void) {
    this.gameState = gameState;
    this.updateStrategyPhase();
    
    const currentTime = Date.now();
    if (currentTime - this.lastDecisionTime >= this.decisionInterval) {
      this.makeStrategicDecision(placeBarrack);
      this.lastDecisionTime = currentTime;
    }
  }

  private updateStrategyPhase() {
    const gameTime = this.gameState.gameTime;
    if (gameTime < 60000) { // First minute
      this.strategyPhase = 'early';
    } else if (gameTime < 180000) { // 1-3 minutes
      this.strategyPhase = 'mid';
    } else {
      this.strategyPhase = 'late';
    }
  }

  private makeStrategicDecision(placeBarrack: (x: number, y: number, unitType: UnitType, owner: 'enemy') => void) {
    // Analyze current situation
    const situation = this.analyzeSituation();
    
    // Choose strategy based on phase and situation
    let strategy: 'economic' | 'military' | 'balanced' | 'aggressive';
    
    if (this.strategyPhase === 'early') {
      strategy = this.getEarlyGameStrategy(situation);
    } else if (this.strategyPhase === 'mid') {
      strategy = this.getMidGameStrategy(situation);
    } else {
      strategy = this.getLateGameStrategy(situation);
    }

    // Execute strategy
    this.executeStrategy(strategy, placeBarrack);
  }

  private analyzeSituation() {
    const playerAdvantage = this.gameState.playerGold - this.gameState.enemyGold;
    const militaryAdvantage = this.gameState.playerUnits - this.gameState.enemyUnits;
    const castleAdvantage = this.gameState.enemyCastleHealth - this.gameState.playerCastleHealth;
    
    return {
      playerAdvantage,
      militaryAdvantage,
      castleAdvantage,
      isBehind: playerAdvantage > 50 || militaryAdvantage > 3,
      isAhead: playerAdvantage < -50 || militaryAdvantage < -3,
      isLosing: this.gameState.enemyCastleHealth < this.gameState.playerCastleHealth * 0.5
    };
  }

  private getEarlyGameStrategy(situation: any): 'economic' | 'military' | 'balanced' | 'aggressive' {
    // Early game: focus on economy and basic units
    if (situation.isBehind) {
      return 'economic'; // Build economy if behind
    }
    return 'balanced'; // Balanced approach in early game
  }

  private getMidGameStrategy(situation: any): 'economic' | 'military' | 'balanced' | 'aggressive' {
    // Mid game: adapt based on situation
    if (situation.isLosing) {
      return 'aggressive'; // All-out attack if losing
    }
    if (situation.isBehind) {
      return 'economic'; // Build up if behind
    }
    if (situation.isAhead) {
      return 'aggressive'; // Push advantage if ahead
    }
    return 'balanced';
  }

  private getLateGameStrategy(situation: any): 'economic' | 'military' | 'balanced' | 'aggressive' {
    // Late game: focus on winning
    if (situation.isLosing) {
      return 'aggressive'; // Desperate attack
    }
    return 'military'; // Focus on military units
  }

  private executeStrategy(strategy: 'economic' | 'military' | 'balanced' | 'aggressive', placeBarrack: (x: number, y: number, unitType: UnitType, owner: 'enemy') => void) {
    const availableGold = this.gameState.enemyGold;
    
    if (strategy === 'economic') {
      this.executeEconomicStrategy(availableGold, placeBarrack);
    } else if (strategy === 'military') {
      this.executeMilitaryStrategy(availableGold, placeBarrack);
    } else if (strategy === 'aggressive') {
      this.executeAggressiveStrategy(availableGold, placeBarrack);
    } else {
      this.executeBalancedStrategy(availableGold, placeBarrack);
    }
  }

  private executeEconomicStrategy(gold: number, placeBarrack: (x: number, y: number, unitType: UnitType, owner: 'enemy') => void) {
    // Focus on cheap units that provide good income
    const economicUnits = [
      { type: UnitType.WARRIOR, priority: 1 },
      { type: UnitType.ARCHER, priority: 2 },
      { type: UnitType.ASSASSIN, priority: 3 }
    ];
    
    this.placeBestAffordableUnit(economicUnits, gold, placeBarrack);
  }

  private executeMilitaryStrategy(gold: number, placeBarrack: (x: number, y: number, unitType: UnitType, owner: 'enemy') => void) {
    // Focus on strong military units
    const militaryUnits = [
      { type: UnitType.KNIGHT, priority: 1 },
      { type: UnitType.PALADIN, priority: 2 },
      { type: UnitType.BERSERKER, priority: 3 },
      { type: UnitType.DRAGON, priority: 4 }
    ];
    
    this.placeBestAffordableUnit(militaryUnits, gold, placeBarrack);
  }

  private executeAggressiveStrategy(gold: number, placeBarrack: (x: number, y: number, unitType: UnitType, owner: 'enemy') => void) {
    // Focus on high-damage, fast units
    const aggressiveUnits = [
      { type: UnitType.ASSASSIN, priority: 1 },
      { type: UnitType.BERSERKER, priority: 2 },
      { type: UnitType.ARCHER, priority: 3 },
      { type: UnitType.MAGE, priority: 4 }
    ];
    
    this.placeBestAffordableUnit(aggressiveUnits, gold, placeBarrack);
  }

  private executeBalancedStrategy(gold: number, placeBarrack: (x: number, y: number, unitType: UnitType, owner: 'enemy') => void) {
    // Balanced approach - mix of units
    const balancedUnits = [
      { type: UnitType.WARRIOR, priority: 1 },
      { type: UnitType.ARCHER, priority: 2 },
      { type: UnitType.KNIGHT, priority: 3 },
      { type: UnitType.MAGE, priority: 4 }
    ];
    
    this.placeBestAffordableUnit(balancedUnits, gold, placeBarrack);
  }

  private placeBestAffordableUnit(unitOptions: Array<{type: UnitType, priority: number}>, gold: number, placeBarrack: (x: number, y: number, unitType: UnitType, owner: 'enemy') => void) {
    // Sort by priority and find the best unit we can afford
    const sortedUnits = unitOptions.sort((a, b) => a.priority - b.priority);
    
    for (const option of sortedUnits) {
      const stats = UNIT_STATS[option.type];
      if (gold >= stats.cost) {
        // Find a good position for the barrack
        const position = this.findBestBarrackPosition();
        if (position) {
          placeBarrack(position.x, position.y, option.type, 'enemy');
          return;
        }
      }
    }
  }

  private findBestBarrackPosition(): {x: number, y: number} | null {
    // AI places barracks in strategic positions
    const positions = [
      { x: 1600, y: 400 }, // Close to enemy castle
      { x: 1600, y: 500 },
      { x: 1600, y: 600 },
      { x: 1700, y: 450 },
      { x: 1700, y: 550 },
      { x: 1500, y: 400 },
      { x: 1500, y: 600 }
    ];
    
    // Return a random position for now (could be improved with more sophisticated positioning)
    const randomIndex = Math.floor(Math.random() * positions.length);
    return positions[randomIndex];
  }

  private createInitialGameState(): GameState {
    return {
      playerGold: 10,
      enemyGold: 10,
      playerBarracks: [],
      enemyBarracks: [],
      playerUnits: 0,
      enemyUnits: 0,
      playerCastleHealth: 1000,
      enemyCastleHealth: 1000,
      gameTime: 0
    };
  }
}
