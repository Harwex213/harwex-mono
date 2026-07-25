import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import {
  BuildingKind,
  type PlayerId,
  type ResourceKind,
  TILE_SIZE,
} from "@hw/colony-sim-v1-core";
import { sheets } from "./textures";

// How a building is drawn, shared by the finished thing and by the placement ghost:
// one description of the art, so what the cursor promises is what gets built.

// A building fills the tile it was placed on, so its frame is laid on that tile —
// anchored at the corner its position names, not centred on the point like a
// creature that merely stands there. Anything else and the ghost, the hover
// highlight and the finished building sit half a tile apart.
const BUILDING_ANCHOR = 0;

// The badge that says which resource a store keeps, one tile above its roof. The
// pile art is a full 16px frame and it is used at that size: scaling it down would
// put half art-pixels beside whole ones, and the plaque behind it is what keeps a
// wood pile readable over grass.
const BADGE_BACKDROP = 0x14180f;
const BADGE_BACKDROP_ALPHA = 0.72;
const BADGE_RADIUS = 3;

// The frames a kind of building is drawn from, for a given player.
function buildingFrames(player: PlayerId, kind: BuildingKind): Texture[] {
  const art = sheets().buildings[player];
  return kind === BuildingKind.Warehouse ? art.store : art.farm;
}

// One building's sprite. `variant` picks among the frames of its kind: pass a hash
// of the entity id and the choice stays out of the save yet never changes for a
// given building.
function buildingSprite(player: PlayerId, kind: BuildingKind, variant: number): Sprite {
  const frames = buildingFrames(player, kind);
  const sprite = new Sprite(frames[variant % frames.length]);
  sprite.anchor.set(BUILDING_ANCHOR);
  return sprite;
}

// The floating resource label. Its own container so the caller only has to position
// the building, and so the ghost can carry the same one.
function resourceBadge(kind: ResourceKind): Container {
  const badge = new Container();
  const plaque = new Graphics()
    .roundRect(0, -TILE_SIZE, TILE_SIZE, TILE_SIZE, BADGE_RADIUS)
    .fill(BADGE_BACKDROP);
  plaque.alpha = BADGE_BACKDROP_ALPHA;
  const icon = new Sprite(sheets().items[kind]);
  icon.y = -TILE_SIZE;
  badge.addChild(plaque, icon);
  return badge;
}

export { buildingSprite, resourceBadge };
