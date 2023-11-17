const UNIT_TYPE = {
  WORKER: 0,
};

type TUnit = {
  id: number;
  type: number;

  x: number;
  y: number;

  movePerTick: number;
  movementPath: [number, number][];
};

export { type TUnit, UNIT_TYPE };
