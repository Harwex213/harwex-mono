import { Container, Graphics, type Renderer, RenderTexture, Sprite } from "pixi.js";
import { HEIGHT, WIDTH } from "./paint";

// Ambient + additive lights in an off-screen buffer, composited over the scene with
// one multiply. Every technique that produces "a lit region" ends here, so the
// buffer lives in lib and the demos only differ in what they add into `scene`.
class LightMap {
  readonly scene = new Container();
  readonly sprite: Sprite;
  private readonly ambient = new Graphics();
  // Lights live in their own layer so a demo can throw them all away (a resolution
  // change rebuilds them) without touching the ambient floor underneath.
  private readonly layer = new Container();
  private readonly texture: RenderTexture;

  constructor(resolution: number) {
    this.texture = RenderTexture.create({ width: WIDTH, height: HEIGHT, resolution });
    this.sprite = new Sprite(this.texture);
    this.sprite.blendMode = "multiply";
    // The ambient floor is opaque on purpose: an unlit texel has to darken the
    // scene, and a transparent texel under a multiply leaves it untouched.
    this.scene.addChild(this.ambient, this.layer);
  }

  // `level` is 0..1; the tint is cold so that warm lights read as warm.
  setAmbient(level: number): void {
    const r = Math.round(255 * level * 0.72);
    const g = Math.round(255 * level * 0.8);
    const b = Math.round(255 * level);
    this.ambient.clear();
    this.ambient.rect(0, 0, WIDTH, HEIGHT).fill((r << 16) | (g << 8) | b);
  }

  add(...children: Container[]): void {
    this.layer.addChild(...children);
  }

  clearLights(): void {
    this.layer.removeChildren();
  }

  render(renderer: Renderer): void {
    renderer.render({ container: this.scene, target: this.texture, clear: true });
  }

  destroy(): void {
    this.texture.destroy(true);
  }
}

export { LightMap };
