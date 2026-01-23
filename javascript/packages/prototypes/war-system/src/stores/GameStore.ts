import { makeAutoObservable } from 'mobx';

export type GameState = 'playing' | 'paused' | 'won' | 'lost';

export class GameStore {
  state: GameState = 'paused';

  constructor() {
    makeAutoObservable(this);
  }

  play(): void {
    this.state = 'playing';
  }

  pause(): void {
    if (this.state === 'playing') {
      this.state = 'paused';
    }
  }

  win(): void {
    this.state = 'won';
  }

  lose(): void {
    this.state = 'lost';
  }

  restart(): void {
    this.state = 'paused';
  }

  get isPlaying(): boolean {
    return this.state === 'playing';
  }

  get isPaused(): boolean {
    return this.state === 'paused';
  }

  get isGameOver(): boolean {
    return this.state === 'won' || this.state === 'lost';
  }
}
