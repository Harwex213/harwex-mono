import { makeAutoObservable } from 'mobx';

export class Castle {
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  owner: 'player' | 'enemy';
  width = 80;
  height = 100;

  constructor(x: number, y: number, owner: 'player' | 'enemy') {
    this.x = x;
    this.y = y;
    this.owner = owner;
    this.maxHealth = 1000;
    this.health = this.maxHealth;
    
    makeAutoObservable(this);
  }

  takeDamage(damage: number) {
    this.health = Math.max(0, this.health - damage);
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  getCenterX(): number {
    return this.x + this.width / 2;
  }

  getCenterY(): number {
    return this.y + this.height / 2;
  }

  getHealthPercentage(): number {
    return this.health / this.maxHealth;
  }
}
