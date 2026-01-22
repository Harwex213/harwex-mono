import { makeAutoObservable } from 'mobx';
import { GameMap } from '@/types';
import { GAME_CONFIG } from '@/config/gameConfig';

export class MapStore {
  map: GameMap;

  constructor() {
    this.map = {
      width: GAME_CONFIG.map.width,
      height: GAME_CONFIG.map.height,
      cellSize: GAME_CONFIG.map.cellSize,
    };
    
    makeAutoObservable(this);
  }

  get canvasWidth(): number {
    return this.map.width * this.map.cellSize;
  }

  get canvasHeight(): number {
    return this.map.height * this.map.cellSize;
  }
}
