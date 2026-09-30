// The lava hall: its own TV in its own room.

import { glassWidth } from "../../core/plate";
import type { Frame, Scene } from "../../core/studio";
import { calibration } from "./plate";
import { LavaRoom } from "./room";
import { LavaTv } from "./tv";

class LavaScene implements Scene {
  private readonly tv: LavaTv;
  private readonly room: LavaRoom;

  constructor(gl: WebGL2RenderingContext) {
    this.tv = new LavaTv(gl);
    this.room = new LavaRoom(gl);
  }

  async init(now: () => number): Promise<void> {
    await Promise.all([this.tv.init(now), this.room.init()]);
  }

  strike(now: number): void {
    this.tv.strike(now);
  }

  render(frame: Frame): void {
    this.tv.resize(glassWidth(calibration, frame.width, frame.height));
    this.tv.render(frame.now);
    const output = this.tv.output;
    if (output) {
      this.room.render(frame, output, this.tv.light(frame.now));
    }
  }
}

export { LavaScene };
