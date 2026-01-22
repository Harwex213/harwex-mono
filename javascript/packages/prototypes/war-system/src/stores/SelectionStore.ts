import { makeAutoObservable } from 'mobx';
import { Vector2 } from '@/types';

export type OrderMode = 'none' | 'move' | 'attack';

export class SelectionStore {
  selectedUnitId: string | null = null;
  hoveredCell: Vector2 | null = null;
  orderMode: OrderMode = 'none';

  constructor() {
    makeAutoObservable(this);
  }

  selectUnit(unitId: string | null): void {
    this.selectedUnitId = unitId;
  }

  setHoveredCell(cell: Vector2 | null): void {
    this.hoveredCell = cell;
  }

  setOrderMode(mode: OrderMode): void {
    this.orderMode = mode;
  }

  clearSelection(): void {
    this.selectedUnitId = null;
    this.orderMode = 'none';
  }
}
