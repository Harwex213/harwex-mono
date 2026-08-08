import { chainSegments, territoryEdges } from "../hex/borders";
import type { Axial } from "../hex/coords";
import { hexKey } from "../hex/coords";
import type { Point } from "../hex/layout";
import { hexCorners, hexToWorld } from "../hex/layout";
import type { IslandMap } from "../map/island";
import { OWNER_PLAYER } from "../map/island";
import type { Camera } from "../state/camera";
import { Background } from "./background";
import { BORDER_BRIGHT, BORDER_DARK, BORDER_SHEEN, HOVER_FILL, HOVER_LINE, SELECT_LINE } from "./palette";
import { drawTop, drawWalls, tracePath } from "./tiles";

type Frame = {
  island: IslandMap;
  camera: Camera;
  hovered: Axial | null;
  selected: Axial | null;
};

class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly background = new Background();
  private borderSource: IslandMap | null = null;
  private borderChains: Point[][] = [];
  private width = 0;
  private height = 0;
  private ratio = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context is not available");
    }
    this.ctx = ctx;
  }

  /** Resizes the backing store so the picture stays crisp on retina screens. */
  resize(cssWidth: number, cssHeight: number, ratio: number): boolean {
    const width = Math.max(1, Math.round(cssWidth));
    const height = Math.max(1, Math.round(cssHeight));
    if (width === this.width && height === this.height && ratio === this.ratio) {
      return false;
    }
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    return true;
  }

  get viewportWidth(): number {
    return this.width;
  }

  get viewportHeight(): number {
    return this.height;
  }

  draw(frame: Frame): void {
    const { ctx } = this;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.background.draw(ctx, this.width, this.height, frame.camera);

    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(frame.camera.scale, frame.camera.scale);
    ctx.translate(-frame.camera.x, -frame.camera.y);

    const hasTile = (q: number, r: number): boolean => frame.island.byKey.has(hexKey(q, r));
    for (const tile of frame.island.tiles) {
      const centre = hexToWorld(tile);
      const corners = hexCorners(centre);
      drawWalls(ctx, tile, corners, hasTile);
      drawTop(ctx, tile, centre, corners);
    }

    this.drawTerritory(frame.island);
    this.drawCursor(frame);

    ctx.restore();
  }

  private drawTerritory(island: IslandMap): void {
    if (this.borderSource !== island) {
      this.borderSource = island;
      this.borderChains = chainSegments(territoryEdges(island.tiles, island.ownerAt, OWNER_PLAYER));
    }
    const { ctx } = this;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const passes: readonly { width: number; colour: string; alpha: number }[] = [
      { width: 11, colour: BORDER_DARK, alpha: 1 },
      { width: 7.4, colour: BORDER_BRIGHT, alpha: 1 },
      { width: 1.6, colour: BORDER_SHEEN, alpha: 0.28 },
    ];
    for (const pass of passes) {
      ctx.globalAlpha = pass.alpha;
      ctx.strokeStyle = pass.colour;
      ctx.lineWidth = pass.width;
      for (const chain of this.borderChains) {
        ctx.beginPath();
        ctx.moveTo(chain[0]!.x, chain[0]!.y);
        for (let index = 1; index < chain.length; index += 1) {
          ctx.lineTo(chain[index]!.x, chain[index]!.y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawCursor(frame: Frame): void {
    const { ctx } = this;
    const { hovered, selected } = frame;
    if (hovered && frame.island.byKey.has(hexKey(hovered.q, hovered.r))) {
      const corners = hexCorners(hexToWorld(hovered));
      tracePath(ctx, corners);
      ctx.fillStyle = HOVER_FILL;
      ctx.fill();
      ctx.strokeStyle = HOVER_LINE;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    if (selected && frame.island.byKey.has(hexKey(selected.q, selected.r))) {
      const corners = hexCorners(hexToWorld(selected));
      tracePath(ctx, corners);
      ctx.strokeStyle = SELECT_LINE;
      ctx.lineWidth = 5;
      ctx.shadowColor = "rgba(255, 212, 121, 0.8)";
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}

export type { Frame };
export { Renderer };
