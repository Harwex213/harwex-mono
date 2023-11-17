export type TSpawnUnitProps = {
  type: number;
  x: number;
  y: number;
  movePerTick: number;
};

export type TMoveUnitProps = {
  unitId: number;
  targetX: number;
  targetY: number;
}
