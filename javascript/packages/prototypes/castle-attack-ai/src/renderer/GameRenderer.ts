import { Application, Graphics, Container, Text, TextStyle } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { GameStore } from '../stores/GameStore';
import { Castle } from '../entities/Castle';
import { Unit } from '../entities/Unit';
import { Barrack } from '../entities/Barrack';
import { UnitType, UNIT_STATS } from '../types/UnitType';

export class GameRenderer {
  private app: Application;
  private viewport: Viewport;
  private gameStore: GameStore;
  private gameContainer: Container;
  private castleGraphics: Map<Castle, Graphics> = new Map();
  private unitGraphics: Map<Unit, Graphics> = new Map();
  private barrackGraphics: Map<Barrack, Graphics> = new Map();
  private uiContainer: Container;

  constructor(app: Application, viewport: Viewport, gameStore: GameStore) {
    this.app = app;
    this.viewport = viewport;
    this.gameStore = gameStore;
    
    this.gameContainer = new Container();
    this.uiContainer = new Container();
    
    this.viewport.addChild(this.gameContainer);
    this.app.stage.addChild(this.uiContainer);
    
    this.setupViewport();
    this.setupUI();
    this.setupInteraction();
    this.render();
  }

  private setupViewport() {
    this.viewport
      .drag()
      .wheel()
      .pinch()
      .decelerate()
      .clampZoom({ minScale: 0.5, maxScale: 2 });
    
    // Add grid background
    this.createGrid();
    
    // Setup interaction for PixiJS v8
    this.viewport.eventMode = 'static';
    this.viewport.cursor = 'grab';
  }

  private createGrid() {
    const gridGraphics = new Graphics();
    const gridSize = 50;
    const worldWidth = 2000;
    const worldHeight = 1000;
    
    // Draw vertical lines
    for (let x = 0; x <= worldWidth; x += gridSize) {
      gridGraphics.moveTo(x, 0);
      gridGraphics.lineTo(x, worldHeight);
    }
    
    // Draw horizontal lines
    for (let y = 0; y <= worldHeight; y += gridSize) {
      gridGraphics.moveTo(0, y);
      gridGraphics.lineTo(worldWidth, y);
    }
    
    gridGraphics.stroke({ width: 1, color: 0x34495e, alpha: 0.3 });
    this.gameContainer.addChildAt(gridGraphics, 0);
  }

  private setupUI() {
    // Add unit selection UI
    this.createUnitSelectionUI();
    // Add status display
    this.createStatusDisplay();
  }

  private createUnitSelectionUI() {
    const unitTypes = Object.values(UnitType);
    const buttonWidth = 80;
    const buttonHeight = 40;
    const spacing = 10;
    const startX = 20;
    const startY = 20;

    unitTypes.forEach((unitType, index) => {
      const button = new Graphics();
      button.rect(0, 0, buttonWidth, buttonHeight);
      button.fill(0x4a4a4a);
      button.stroke({ width: 2, color: 0x666666 });
      
      button.x = startX + index * (buttonWidth + spacing);
      button.y = startY;
      
      // Add unit type text with cost
      const stats = UNIT_STATS[unitType];
      const text = new Text({
        text: `${unitType.toUpperCase()}\n${stats.cost}G`,
        style: new TextStyle({
          fontSize: 9,
          fill: 0xffffff,
          align: 'center'
        })
      });
      text.anchor.set(0.5);
      text.x = buttonWidth / 2;
      text.y = buttonHeight / 2;
      button.addChild(text);
      
      // Make button interactive
      button.eventMode = 'static';
      button.cursor = 'pointer';
      button.on('pointerdown', () => {
        this.selectUnitType(unitType);
      });
      
      // Store reference for highlighting
      (button as any).unitType = unitType;
      
      this.uiContainer.addChild(button);
    });
  }

  private setupInteraction() {
    // Handle clicks on the game world for barracks placement
    this.viewport.on('pointerdown', (event) => {
      const worldPos = this.viewport.toWorld(event.global);
      this.handleWorldClick(worldPos.x, worldPos.y);
    });
  }

  private handleWorldClick(x: number, y: number) {
    if (this.gameStore.selectedUnitType) {
      // Place barrack for player
      this.gameStore.placeBarrack(x, y, 'player');
    }
  }

  private createStatusDisplay() {
    const statusText = new Text({
      text: 'Castle Attack AI - Select a unit type and click to place barracks',
      style: new TextStyle({
        fontSize: 16,
        fill: 0xffffff,
        align: 'left'
      })
    });
    statusText.x = 20;
    statusText.y = window.innerHeight - 40;
    this.uiContainer.addChild(statusText);
    
    // Create gold display
    this.createGoldDisplay();
  }

  private createGoldDisplay() {
    const goldContainer = new Container();
    goldContainer.x = window.innerWidth - 200;
    goldContainer.y = 20;
    
    // Gold background
    const goldBg = new Graphics();
    goldBg.rect(0, 0, 180, 50);
    goldBg.fill(0x2c3e50);
    goldBg.stroke({ width: 2, color: 0xFFD700 });
    goldContainer.addChild(goldBg);
    
    // Gold icon
    const goldIcon = new Graphics();
    goldIcon.circle(25, 25, 15);
    goldIcon.fill(0xFFD700);
    goldContainer.addChild(goldIcon);
    
    // Gold text
    const goldText = new Text({
      text: `Player Gold: ${this.gameStore.gold}`,
      style: new TextStyle({
        fontSize: 16,
        fill: 0xffffff,
        align: 'left'
      })
    });
    goldText.x = 50;
    goldText.y = 10;
    goldContainer.addChild(goldText);
    
    // Enemy gold text
    const enemyGoldText = new Text({
      text: `Enemy Gold: ${this.gameStore.enemyGold}`,
      style: new TextStyle({
        fontSize: 14,
        fill: 0xff6b6b,
        align: 'left'
      })
    });
    enemyGoldText.x = 50;
    enemyGoldText.y = 30;
    goldContainer.addChild(enemyGoldText);
    
    this.uiContainer.addChild(goldContainer);
    
    // Store reference for updates
    (this.uiContainer as any).goldText = goldText;
    (this.uiContainer as any).enemyGoldText = enemyGoldText;
    
    // Create wave timer display
    this.createWaveTimer();
  }

  private createWaveTimer() {
    const timerContainer = new Container();
    timerContainer.x = window.innerWidth - 200;
    timerContainer.y = 80;
    
    // Timer background
    const timerBg = new Graphics();
    timerBg.rect(0, 0, 180, 40);
    timerBg.fill(0x2c3e50);
    timerBg.stroke({ width: 2, color: 0x3498db });
    timerContainer.addChild(timerBg);
    
    // Timer icon (clock)
    const timerIcon = new Graphics();
    timerIcon.circle(20, 20, 12);
    timerIcon.stroke({ width: 2, color: 0x3498db });
    timerContainer.addChild(timerIcon);
    
    // Timer text
    const timerText = new Text({
      text: `Next Wave: 20s`,
      style: new TextStyle({
        fontSize: 16,
        fill: 0xffffff,
        align: 'left'
      })
    });
    timerText.x = 40;
    timerText.y = 12;
    timerContainer.addChild(timerText);
    
    this.uiContainer.addChild(timerContainer);
    
    // Store reference for updates
    (this.uiContainer as any).timerText = timerText;
  }

  private selectUnitType(unitType: UnitType) {
    this.gameStore.selectUnitType(unitType);
  }

  render() {
    this.renderCastles();
    this.renderUnits();
    this.renderBarracks();
  }

  private renderCastles() {
    this.gameStore.castles.forEach(castle => {
      if (!this.castleGraphics.has(castle)) {
        const graphics = new Graphics();
        this.castleGraphics.set(castle, graphics);
        this.gameContainer.addChild(graphics);
      }
      
      const graphics = this.castleGraphics.get(castle)!;
      graphics.clear();
      
      // Draw castle
      const color = castle.owner === 'player' ? 0x4a90e2 : 0xe74c3c;
      graphics.rect(castle.x, castle.y, castle.width, castle.height);
      graphics.fill(color);
      graphics.stroke({ width: 3, color: 0x2c3e50 });
      
      // Draw health bar
      const healthBarWidth = castle.width;
      const healthBarHeight = 6;
      const healthBarY = castle.y - 10;
      
      // Background
      graphics.rect(castle.x, healthBarY, healthBarWidth, healthBarHeight);
      graphics.fill(0x2c3e50);
      
      // Health
      const healthWidth = healthBarWidth * castle.getHealthPercentage();
      graphics.rect(castle.x, healthBarY, healthWidth, healthBarHeight);
      graphics.fill(castle.getHealthPercentage() > 0.3 ? 0x27ae60 : 0xe74c3c);
    });
  }

  private renderUnits() {
    // Remove graphics for units that no longer exist
    this.unitGraphics.forEach((graphics, unit) => {
      if (!this.gameStore.units.includes(unit)) {
        graphics.destroy();
        this.unitGraphics.delete(unit);
      }
    });

    this.gameStore.units.forEach(unit => {
      if (!this.unitGraphics.has(unit)) {
        const graphics = new Graphics();
        this.unitGraphics.set(unit, graphics);
        this.gameContainer.addChild(graphics);
      }
      
      const graphics = this.unitGraphics.get(unit)!;
      graphics.clear();
      
      if (unit.health <= 0) return;
      
      // Draw unit
      graphics.circle(unit.x + unit.size / 2, unit.y + unit.size / 2, unit.size / 2);
      graphics.fill(unit.color);
      graphics.stroke({ width: 1, color: 0x2c3e50 });
      
      // Draw health bar for units with low health
      if (unit.health < unit.maxHealth) {
        const healthBarWidth = unit.size;
        const healthBarHeight = 3;
        const healthBarY = unit.y - 5;
        
        // Background
        graphics.rect(unit.x, healthBarY, healthBarWidth, healthBarHeight);
        graphics.fill(0x2c3e50);
        
        // Health
        const healthPercentage = unit.health / unit.maxHealth;
        const healthWidth = healthBarWidth * healthPercentage;
        graphics.rect(unit.x, healthBarY, healthWidth, healthBarHeight);
        graphics.fill(healthPercentage > 0.3 ? 0x27ae60 : 0xe74c3c);
      }
    });
  }

  private renderBarracks() {
    // Remove graphics for barracks that no longer exist
    this.barrackGraphics.forEach((graphics, barrack) => {
      if (!this.gameStore.barracks.includes(barrack)) {
        graphics.destroy();
        this.barrackGraphics.delete(barrack);
      }
    });

    this.gameStore.barracks.forEach(barrack => {
      if (!this.barrackGraphics.has(barrack)) {
        const graphics = new Graphics();
        this.barrackGraphics.set(barrack, graphics);
        this.gameContainer.addChild(graphics);
      }
      
      const graphics = this.barrackGraphics.get(barrack)!;
      graphics.clear();
      
      // Draw barrack
      const color = barrack.owner === 'player' ? 0x3498db : 0xe67e22;
      graphics.rect(barrack.x, barrack.y, barrack.width, barrack.height);
      graphics.fill(color);
      graphics.stroke({ width: 2, color: 0x2c3e50 });
      
      // Draw unit type indicator
      if (barrack.unitType) {
        const indicatorSize = 8;
        const centerX = barrack.x + barrack.width / 2;
        const centerY = barrack.y + barrack.height / 2;
        
        graphics.circle(centerX, centerY, indicatorSize);
        graphics.fill(0x2c3e50);
      }
    });
  }

  update() {
    this.render();
    this.updateGoldDisplay();
  }

  private updateGoldDisplay() {
    const goldText = (this.uiContainer as any).goldText;
    if (goldText) {
      goldText.text = `Player Gold: ${this.gameStore.gold}`;
    }
    
    const enemyGoldText = (this.uiContainer as any).enemyGoldText;
    if (enemyGoldText) {
      enemyGoldText.text = `Enemy Gold: ${this.gameStore.enemyGold}`;
    }
    
    // Update wave timer
    const timerText = (this.uiContainer as any).timerText;
    if (timerText) {
      const timeRemaining = this.gameStore.timeUntilNextWave;
      timerText.text = `Next Wave: ${timeRemaining}s`;
    }
  }
}
