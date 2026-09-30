// The gold studio: its own TV in its own room.

import { glassWidth } from "../../core/plate";
import type { Frame, Scene } from "../../core/studio";
import { calibration } from "./plate";
import { GoldRoom } from "./room";
import { GoldTv } from "./tv";

class GoldScene implements Scene {
  private readonly tv: GoldTv;
  private readonly room: GoldRoom;

  constructor(gl: WebGL2RenderingContext) {
    this.tv = new GoldTv(gl);
    this.room = new GoldRoom(gl);
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

export { GoldScene };
