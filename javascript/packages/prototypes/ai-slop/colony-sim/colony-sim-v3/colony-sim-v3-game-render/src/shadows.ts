import { ColorMatrixFilter, Container, Graphics, type Renderer, Sprite, type Texture } from "pixi.js";
import { type EntityId, TILE_SIZE } from "@hw/colony-sim-v3-core";

// Where the light comes from, as a direction in art px: shadows fall down and to
// the right. One vector for the whole map — a cliff's throw and a colonist's blob
// have to agree about the sun, and the only thing that may differ between them is
// how far the shadow reaches, which is how tall the caster is.
const LIGHT_X = 1;
const LIGHT_Y = 0.55;

// A cliff stands a tile tall, so it throws the longest shadow on the map. A
// creature standing on the ground barely throws one at all: its shadow is contact,
// not cast, and the nudge only keeps the blob from looking pasted on symmetrically.
const CLIFF_THROW_PX = 3;
const CONTACT_THROW_PX = 1;

// Rounded once here rather than per frame: an offset of 1.65px would put every
// shadow half a pixel off the art grid, which is the same shimmer the camera
// rounds its own offset to avoid.
const CLIFF_OFFSET_X = Math.round(LIGHT_X * CLIFF_THROW_PX);
const CLIFF_OFFSET_Y = Math.round(LIGHT_Y * CLIFF_THROW_PX);
const CONTACT_OFFSET_X = Math.round(LIGHT_X * CONTACT_THROW_PX);
const CONTACT_OFFSET_Y = Math.round(LIGHT_Y * CONTACT_THROW_PX);

const CLIFF_SHADOW_ALPHA = 0.34;
const CONTACT_SHADOW_ALPHA = 0.3;

// The blob every caster on legs gets: one ellipse a tile wide and a quarter of a
// tile tall, generated once and scaled per kind.
const BLOB_RX = TILE_SIZE / 2;
const BLOB_RY = TILE_SIZE / 4;

// Per caster: how much of the blob it gets, and how far below its tile point the
// blob sits. Both are eyeballed against the art rather than derived from it — what
// a contact shadow has to sell is the line where the thing touches the ground.
//
// `drop` exists because the tile point is not that line: the sprite anchors put it
// wherever the sheet draws the thing's feet inside the 16px frame, and for anything
// that sits rather than stands (a boulder) that is halfway up the silhouette. A
// blob centred there pokes out over the shoulders of its own caster, which reads as
// an outline and not as a shadow.
const BLOB = {
  colonist: { scale: 0.45, drop: 1 },
  chicken: { scale: 0.34, drop: 1 },
  tree: { scale: 0.7, drop: 1 },
  // Boulders come in three sheet sizes, picked per rock. One shadow for all three
  // reads fine at a tile's scale and keeps that pick where it belongs — in the
  // choice of texture, not here.
  rock: { scale: 0.55, drop: 3 },
} as const;

type ShadowCaster = keyof typeof BLOB;

// Contact shadows under the moving entities: a pool reconciled by the renderer in
// lockstep with the sprite pool, in a layer of its own below every caster.
class ShadowPool {
  private layer: Container;
  private blob: Texture;
  private shadows = new Map<EntityId, { view: Sprite; drop: number }>();

  constructor(renderer: Renderer, layer: Container) {
    this.layer = layer;
    this.layer.filters = [shadowFilter(CONTACT_SHADOW_ALPHA)];
    this.blob = blobTexture(renderer);
  }

  attach(id: EntityId, caster: ShadowCaster): void {
    const { scale, drop } = BLOB[caster];
    const view = new Sprite(this.blob);
    view.anchor.set(0.5, 0.5);
    view.scale.set(scale);
    this.layer.addChild(view);
    this.shadows.set(id, { view, drop });
  }

  detach(id: EntityId): void {
    const shadow = this.shadows.get(id);
    if (!shadow) {
      return;
    }
    shadow.view.destroy();
    this.shadows.delete(id);
  }

  // World px, already interpolated: the shadow goes to the caster's own tile point,
  // dropped to where the art actually meets the ground and nudged along the light.
  move(id: EntityId, x: number, y: number): void {
    const shadow = this.shadows.get(id);
    if (!shadow) {
      return;
    }
    shadow.view.position.set(x + CONTACT_OFFSET_X, y + CONTACT_OFFSET_Y + shadow.drop);
  }
}

// The shadow of something already drawn: the very same view again, moved along the
// light and flattened to black. Sound only for a caster whose silhouette *is* its
// footprint — the cliff sheet's rounded frames are exactly that, and re-painting
// them is cheaper than deriving a separate shadow shape from the same neighbours.
function castShadow(view: Container): Container {
  view.position.set(CLIFF_OFFSET_X, CLIFF_OFFSET_Y);
  view.filters = [shadowFilter(CLIFF_SHADOW_ALPHA)];
  return view;
}

// Turns whatever it is put on into that thing's shadow: every pixel to black, the
// silhouette kept through alpha, the group faded as a whole. Flattening the group
// is the point and not a side effect — two shadows that cross have to read as one
// shadow rather than as a darker patch where they meet — and it also settles the
// colour for a subtree whose own shader we do not control: the cliff shadow is a
// tilemap, not a sprite, and would not answer to a tint.
function shadowFilter(alpha: number): ColorMatrixFilter {
  const filter = new ColorMatrixFilter();
  // 5×4, row-major: r, g, b scaled to nothing, alpha scaled to `alpha`.
  filter.matrix = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, alpha, 0];
  return filter;
}

// White, because the filter decides the colour; unantialiased at resolution 1 and
// sampled `nearest`, because a soft oval would be the one airbrushed thing on a
// pixel-art map — this way the blob stays blocky at ×8 zoom like everything else.
function blobTexture(renderer: Renderer): Texture {
  const shape = new Graphics().ellipse(BLOB_RX, BLOB_RY, BLOB_RX, BLOB_RY).fill(0xffffff);
  const texture = renderer.generateTexture({ target: shape, resolution: 1, antialias: false });
  texture.source.scaleMode = "nearest";
  shape.destroy();
  return texture;
}

export type { ShadowCaster };
export { castShadow, ShadowPool };
