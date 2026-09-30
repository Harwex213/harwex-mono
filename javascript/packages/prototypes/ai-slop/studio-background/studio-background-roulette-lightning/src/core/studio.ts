// Runs one brand's scene on a canvas: the WebGL context, the clock, the frame loop and the dev hooks.
// The scene owns everything that is drawn.

type Frame = {
  now: number;
  width: number;
  height: number;
  isDebug: boolean;
};

type Scene = {
  // Loads assets and builds GPU state. now reads the studio clock.
  init: (now: () => number) => Promise<void>;
  strike: (now: number) => void;
  render: (frame: Frame) => void;
};

type SceneFactory = (gl: WebGL2RenderingContext) => Scene;

type Options = {
  isDebug: () => boolean;
};

class StudioRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly options: Options;
  private readonly scene: Scene;
  private frame = 0;
  private readonly start = performance.now();
  private disposed = false;
  // Dev hook: when set, the clock is frozen at this time in seconds.
  private frozenAt: number | null = null;

  constructor(canvas: HTMLCanvasElement, createScene: SceneFactory, options: Options) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
    if (!gl) {
      throw new Error("WebGL2 is not available");
    }
    this.canvas = canvas;
    this.options = options;
    this.scene = createScene(gl);
  }

  async init(): Promise<void> {
    await this.scene.init(() => this.now());
    if (this.disposed) {
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  }

  strike(): void {
    this.scene.strike(this.now());
  }

  // Freezes the clock at t seconds; null resumes real time.
  seek(t: number | null): void {
    this.frozenAt = t;
  }

  // Dev hook: renders one frame right now, for captures while the clock is frozen.
  renderNow(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(this.canvas.clientWidth * dpr);
    const height = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.scene.render({ now: this.now(), width, height, isDebug: this.options.isDebug() });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
  }

  private now(): number {
    if (this.frozenAt !== null) {
      return this.frozenAt;
    }
    return (performance.now() - this.start) / 1000;
  }

  private tick = (): void => {
    if (this.disposed) {
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
    this.renderNow();
  };
}

export type { Frame, Scene, SceneFactory };

export { StudioRenderer };
