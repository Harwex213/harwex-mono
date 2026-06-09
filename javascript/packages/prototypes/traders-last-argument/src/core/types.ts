enum TileType {
  FertileLand = "fertile_land",
  Mountain = "mountain",
}

enum ObjectType {
  Tree = "tree",
  Stone = "stone",
}

interface Tile {
  type: TileType;
  object: ObjectType | null;
}

type GameMap = Tile[][];

interface Pawn {
  id: number;
  name: string;
  health: number;
  maxHealth: number;
  x: number;
  y: number;
  targetCol: number;
  targetRow: number;
  idleTimer: number;
}

interface GameState {
  map: GameMap;
  pawns: Pawn[];
}

export { TileType, ObjectType };
export type { Tile, GameMap, Pawn, GameState };
