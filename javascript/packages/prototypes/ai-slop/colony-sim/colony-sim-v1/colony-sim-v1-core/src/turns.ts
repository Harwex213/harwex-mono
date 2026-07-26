import type { ClockCommand, CommandSink, WorldCommand } from "./commands";
import { paused, speed } from "./state/signals";

// Where the sim gets permission to advance, and the seam multiplayer plugs into.
//
// The engine used to own the accumulator, which meant it also owned the answer to
// "may I tick now" — and over a network that answer is not the local clock's to give.
// So the clock moved out: a source is handed real time and hands back the steps to
// run. Single-player is an accumulator over the frame delta; lockstep is the turn
// stream the server broadcasts. The engine cannot tell which it has, and that is the
// whole trick — the sim is the same code in both, and the network is not a mode inside
// it.

const TICK_MS = 100; // 10 logical ticks per second

// A frame that fell far behind (a backgrounded tab, a long GC) must not bank its lost
// time and then sprint through it: dozens of ticks in one frame is a visible jump and,
// on the network path, a client outrunning the turns it has. Past this the excess is
// dropped instead of owed.
const MAX_STEPS_PER_FRAME = 8;

// One step of the sim: the orders to apply, and whether the clock moves.
//
// `advance: false` is a pause — orders land on a frozen world without a tick. The
// dev-game's spawn buttons need that (a paused game runs no ticks at all, and a spawn
// that only appeared on resume would be useless), and lockstep needs the same shape
// for the same reason: a turn is what the world is a function of, so a paused game
// must still be able to receive one.
interface TurnStep {
  commands: readonly WorldCommand[];
  advance: boolean;
}

// The clock, as the engine sees it. `CommandSink` is the write half — a dispatcher
// hands commands here — and `pump` is the read half.
interface TurnSource extends CommandSink {
  // Real milliseconds in, the steps to run this frame out, in order.
  pump(deltaMs: number): TurnStep[];
  // Progress through the tick in flight, 0..1, for the renderer's interpolation.
  alpha(): number;
}

// The single-player clock: local time, local pause, local orders, applied on the next
// tick boundary. Also the fallback for any host that does not pass a source, so
// dev-game and a solo web game keep the loop they always had.
class LocalTurnSource implements TurnSource {
  private pending: WorldCommand[] = [];
  private accumulator = 0;

  pump(deltaMs: number): TurnStep[] {
    this.accumulator += deltaMs * (paused.value ? 0 : speed.value);
    const steps: TurnStep[] = [];
    while (this.accumulator >= TICK_MS) {
      if (steps.length >= MAX_STEPS_PER_FRAME) {
        this.accumulator = TICK_MS;
        break;
      }
      // Orders ride the first tick of the frame rather than being spread over it: they
      // arrived before any of these ticks did, and splitting them would make how many
      // ticks a frame happens to carry part of the sim's behaviour.
      steps.push({ commands: steps.length === 0 ? this.take() : [], advance: true });
      this.accumulator -= TICK_MS;
    }
    if (steps.length === 0 && this.pending.length > 0) {
      steps.push({ commands: this.take(), advance: false });
    }
    return steps;
  }

  alpha(): number {
    return this.accumulator / TICK_MS;
  }

  submit(command: WorldCommand): void {
    this.pending.push(command);
  }

  // Nobody else to agree with: pause and speed are this client's own.
  setClock(command: ClockCommand): void {
    if (command.type === "togglePause") {
      paused.value = !paused.value;
      return;
    }
    speed.value = command.value;
  }

  private take(): WorldCommand[] {
    const pending = this.pending;
    this.pending = [];
    return pending;
  }
}

export type { TurnSource, TurnStep };
export { LocalTurnSource, MAX_STEPS_PER_FRAME, TICK_MS };
