import { Container, Graphics, Sprite } from "pixi.js";
import { TILE_SIZE } from "@hw/colony-sim-v1-core";
import { sheets } from "./textures";

// Rendered frames per pulse step. Counted in frames, not sim ticks: the marker is
// UI, so it keeps breathing while the game is paused (unlike the walk cycles).
const PULSE_FRAMES = 20;

// Entity sprites stand with their feet on the tile point and their body drawn
// above it, so the marker hangs slightly below its own centre to frame the body.
const ENTITY_ANCHOR_Y = 0.55;

const WASH_COLOR = 0xffffff;

// A marker style is what separates "this is selected" from "this is what a click
// would take": same brackets, dimmed and static for hover, plus a faint wash so
// bare ground reads as a target too — without it, empty tiles look inert.
interface MarkerStyle {
  alpha: number;
  pulse: boolean;
  wash: number; // tile fill alpha; 0 = no wash
}

const SELECTION_STYLE: MarkerStyle = { alpha: 1, pulse: true, wash: 0 };
const HOVER_STYLE: MarkerStyle = { alpha: 0.5, pulse: false, wash: 0.14 };

// The corner brackets drawn over a tile or an entity. One sprite (plus an
// optional tile wash) in the `fx` layer, repositioned every frame — no
// reconciliation needed for a single marker.
class Marker {
  private style: MarkerStyle;
  private brackets: Sprite;
  private wash: Graphics | null = null;
  private frames = 0;

  constructor(parent: Container, style: MarkerStyle) {
    this.style = style;
    if (style.wash > 0) {
      this.wash = new Graphics().rect(0, 0, TILE_SIZE, TILE_SIZE).fill(WASH_COLOR);
      this.wash.alpha = style.wash;
      this.wash.visible = false;
      parent.addChild(this.wash);
    }
    this.brackets = new Sprite(sheets().selector[0]);
    this.brackets.alpha = style.alpha;
    this.brackets.visible = false;
    parent.addChild(this.brackets);
  }

  // Frame a whole tile: the brackets land on the tile's own corners.
  atTile(x: number, y: number): void {
    this.brackets.anchor.set(0, 0);
    this.brackets.position.set(x * TILE_SIZE, y * TILE_SIZE);
    if (this.wash) {
      this.wash.position.set(x * TILE_SIZE, y * TILE_SIZE);
      this.wash.visible = true;
    }
    this.show();
  }

  // Follow an entity sprite's already-interpolated position instead of its tile,
  // so the brackets stay glued to a walking colonist between ticks.
  atSprite(target: Container): void {
    this.brackets.anchor.set(0.5, ENTITY_ANCHOR_Y);
    this.brackets.position.copyFrom(target.position);
    if (this.wash) {
      this.wash.visible = false;
    }
    this.show();
  }

  hide(): void {
    this.brackets.visible = false;
    if (this.wash) {
      this.wash.visible = false;
    }
  }

  private show(): void {
    this.brackets.visible = true;
    if (!this.style.pulse) {
      return;
    }
    this.frames += 1;
    this.brackets.texture = sheets().selector[Math.floor(this.frames / PULSE_FRAMES) % 2];
  }
}

export { Marker, SELECTION_STYLE, HOVER_STYLE };
