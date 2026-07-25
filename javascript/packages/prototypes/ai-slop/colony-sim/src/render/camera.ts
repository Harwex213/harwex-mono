import type { Application, Container, Ticker } from "pixi.js";
import { GRID_H, GRID_W, TILE_SIZE } from "@/sim/grid";
import type { Command, CommandDispatcher } from "@/commands";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const DEFAULT_ZOOM = 3;
const WHEEL_ZOOM_RATE = 0.0015; // exponential factor per wheel pixel
const LINE_HEIGHT_PX = 16; // deltaMode === DOM_DELTA_LINE
const KEY_PAN_SPEED = 700; // screen px per second
const DRAG_BUTTONS = new Set([0, 1]); // left / middle drag

// Camera keys → pan direction of the *view* (not of the world container).
const PAN_KEYS: Record<string, readonly [number, number]> = {
  arrowleft: [-1, 0],
  a: [-1, 0],
  arrowright: [1, 0],
  d: [1, 0],
  arrowup: [0, -1],
  w: [0, -1],
  arrowdown: [0, 1],
  s: [0, 1],
};

// One-shot keys fired on keydown; unlike PAN_KEYS they are not held over frames.
const COMMAND_KEYS: Record<string, Command> = {
  " ": { type: "togglePause" },
  "1": { type: "setSpeed", value: 1 },
  "2": { type: "setSpeed", value: 2 },
  "3": { type: "setSpeed", value: 3 },
};

// Screen-space camera over the pixi root container: drag / key panning plus
// cursor-anchored wheel zoom. Pure view state — the sim never sees it, so world
// coordinates stay tile-based. Offsets are kept as floats and only rounded on
// the way into pixi so the pixel-art grid does not shimmer while panning.
// It also owns the keyboard bindings, forwarding non-view keys to the dispatcher.
class Camera {
  private app: Application;
  private root: Container;
  private commands: CommandDispatcher;
  private zoom = DEFAULT_ZOOM;
  private x = 0;
  private y = 0;
  private dragPointer: number | null = null;
  private dragX = 0;
  private dragY = 0;
  private keys = new Set<string>();

  constructor(app: Application, root: Container, commands: CommandDispatcher) {
    this.app = app;
    this.root = root;
    this.commands = commands;

    const canvas = app.canvas;
    canvas.style.cursor = "grab";
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerEnd);
    canvas.addEventListener("pointercancel", this.onPointerEnd);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    globalThis.addEventListener("keydown", this.onKeyDown);
    globalThis.addEventListener("keyup", this.onKeyUp);
    globalThis.addEventListener("blur", this.onBlur);
    app.renderer.on("resize", this.commit);
    app.ticker.add(this.onTick);

    this.centerOn(GRID_W / 2, GRID_H / 2);
  }

  // Put a tile at the middle of the viewport (clamped to the world bounds).
  centerOn(tileX: number, tileY: number): void {
    this.x = this.app.screen.width / 2 - tileX * TILE_SIZE * this.zoom;
    this.y = this.app.screen.height / 2 - tileY * TILE_SIZE * this.zoom;
    this.commit();
  }

  // Screen (canvas CSS px) → tile coords; for picking, build placement, tooltips.
  screenToTile(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.x) / (TILE_SIZE * this.zoom),
      y: (screenY - this.y) / (TILE_SIZE * this.zoom),
    };
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.dragPointer !== null || !DRAG_BUTTONS.has(event.button)) {
      return;
    }
    this.dragPointer = event.pointerId;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    this.app.canvas.setPointerCapture(event.pointerId);
    this.app.canvas.style.cursor = "grabbing";
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointer) {
      return;
    }
    this.x += event.clientX - this.dragX;
    this.y += event.clientY - this.dragY;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    this.commit();
  };

  private onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointer) {
      return;
    }
    this.dragPointer = null;
    this.app.canvas.releasePointerCapture(event.pointerId);
    this.app.canvas.style.cursor = "grab";
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * LINE_HEIGHT_PX : event.deltaY;
    const next = clamp(this.zoom * Math.exp(-delta * WHEEL_ZOOM_RATE), MIN_ZOOM, MAX_ZOOM);
    if (next === this.zoom) {
      return;
    }
    // Keep the world point under the cursor pinned to the cursor.
    const rect = this.app.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    this.x = screenX - ((screenX - this.x) / this.zoom) * next;
    this.y = screenY - ((screenY - this.y) / this.zoom) * next;
    this.zoom = next;
    this.commit();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    const command = COMMAND_KEYS[key];
    if ((!PAN_KEYS[key] && !command) || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(input|textarea|select|button)$/i.test(target.tagName))) {
      return;
    }
    event.preventDefault();
    if (command) {
      // Autorepeat would toggle pause dozens of times while the key is held.
      if (!event.repeat) {
        this.commands.dispatch(command);
      }
      return;
    }
    this.keys.add(key);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  private onTick = (ticker: Ticker): void => {
    if (this.keys.size === 0) {
      return;
    }
    let dx = 0;
    let dy = 0;
    for (const key of this.keys) {
      const dir = PAN_KEYS[key];
      if (dir) {
        dx += dir[0];
        dy += dir[1];
      }
    }
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      return;
    }
    const step = (KEY_PAN_SPEED * ticker.deltaMS) / 1000 / length;
    this.x -= dx * step;
    this.y -= dy * step;
    this.commit();
  };

  // Clamp, then push the view state into pixi. Also runs on canvas resize.
  private commit = (): void => {
    this.x = clampAxis(this.x, GRID_W * TILE_SIZE * this.zoom, this.app.screen.width);
    this.y = clampAxis(this.y, GRID_H * TILE_SIZE * this.zoom, this.app.screen.height);
    this.root.scale.set(this.zoom);
    this.root.x = Math.round(this.x);
    this.root.y = Math.round(this.y);
  };
}

// Keep the world inside the viewport; center it when it is smaller than the view.
function clampAxis(offset: number, worldPx: number, viewPx: number): number {
  if (worldPx <= viewPx) {
    return (viewPx - worldPx) / 2;
  }
  return Math.min(0, Math.max(viewPx - worldPx, offset));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export { Camera, DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM };
