import { makeAutoObservable } from 'mobx';
import { UnitType } from '../types/UnitType';

export class Barrack {
  x: number;
  y: number;
  unitType: UnitType | null;
  owner: 'player' | 'enemy';
  width = 40;
  height = 40;

  constructor(x: number, y: number, unitType: UnitType | null, owner: 'player' | 'enemy') {
    this.x = x;
    this.y = y;
    this.unitType = unitType;
    this.owner = owner;
    
    makeAutoObservable(this);
  }

  setUnitType(unitType: UnitType) {
    this.unitType = unitType;
  }

  getCenterX(): number {
    return this.x + this.width / 2;
  }

  getCenterY(): number {
    return this.y + this.height / 2;
  }
}
