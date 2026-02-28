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

export { TileType, ObjectType };
export type { Tile, GameMap };
