import {
  type ClockCommand,
  hashWorld,
  MAX_STEPS_PER_FRAME,
  paused,
  speed,
  TICK_MS,
  type TurnSource,
  type TurnStep,
  type World,
  type WorldCommand,
} from "@hw/colony-sim-v1-core";
import type { ServerMessage } from "@hw/colony-sim-v1-protocol";
import type { GameSocket } from "./game-socket";
import { bufferedTurns, desyncedAt, waitingFor } from "./status";
import { parseCommand, seatOfPlayer } from "./wire";

// The clock of a networked game: the server's turns, spent at the local frame rate.
//
// This is the whole of lockstep on the client. It never touches the world — it only says
// which orders belong to which tick, and the engine does the rest. The world is therefore
// a function of two things and no others: the seed in the start message, and the sequence
// of turns that follows it. Nothing about *this* client can enter into it, which is why
// two browsers stay equal without ever exchanging a colonist.

// Turns held in reserve before the sim is allowed to spend one. The network delivers in
// clumps — one turn late, then two at once — and without a cushion every clump is a
// stutter. Two turns is 200ms of jitter absorbed, at the price of 200ms more between a
// click and its effect.
const TARGET_BUFFER = 2;

// A backlog this deep means the sim is behind the stream, not merely jittery: a
// backgrounded tab, a slow frame, a client that just attached to a game in progress. The
// excess is spent by running extra ticks per frame rather than by skipping turns — a
// skipped turn is a different world, a fast turn is only an ugly second.
const MAX_BUFFER = 12;

// How many turns a catching-up frame may burn, as against the cap on a frame that is
// merely keeping time. It has to beat the stream's rate, and the reason is the browser: a
// tab that is not on screen gets about one frame a second while turns keep arriving at ten,
// so a frame that could only spend eight of them would never catch up at all — the backlog
// would grow for as long as the tab stayed hidden.
//
// In practice a burst ends at the next hash boundary rather than here (see `take`), so this
// is a ceiling and HASH_EVERY is the real step: still twice the stream's rate at one frame
// a second, and a hundred times it on a tab that is being looked at. Ticks are cheap next
// to frames, which is what makes spending a hundred of them in one frame reasonable.
const CATCHUP_STEPS_PER_FRAME = 200;

// How often this client states what its world looks like. Every turn would be wasteful
// (the hash walks every entity); too rarely and a desync is a hundred turns old before
// anyone hears about it, by which point the cause is off the screen.
const HASH_EVERY = 20;

interface Queued {
  turn: number;
  step: TurnStep;
}

class LockstepTurnSource implements TurnSource {
  private readonly socket: GameSocket;
  private readonly world: World;
  private readonly players: readonly string[];
  private queue: Queued[] = [];
  private clockMs = 0;
  private tickMs = TICK_MS;
  // The last turn the server sent. Turns arrive over a socket, so a gap means the server
  // and this client no longer agree on what turn it is — worth shouting about, not worth
  // trying to paper over.
  private received = 0;
  // The last turn handed to the engine, and the next one to be hashed.
  private executed = 0;
  private nextHash = HASH_EVERY;
  private hashDue = false;

  constructor(socket: GameSocket, world: World) {
    this.socket = socket;
    this.world = world;
    this.players = socket.start.players;
    this.applyClock(socket.start.paused, socket.start.speed);
    socket.listen((message) => this.receive(message));
  }

  // Real time in, the steps the sim may run out. Called once per rendered frame.
  pump(deltaMs: number): TurnStep[] {
    this.reportHash();
    this.clockMs += deltaMs;
    const steps: TurnStep[] = [];

    // Orders on a frozen world (`advance: false`) cost no time — a paused game has no
    // ticks to spend, and a spawn dropped on it still has to land. They also never wait
    // for the cushion: nothing about a paused game is smoothed by holding them back.
    while (this.queue.length > 0 && !this.queue[0].step.advance && steps.length < MAX_STEPS_PER_FRAME) {
      if (this.take(steps)) {
        break;
      }
    }

    while (this.clockMs >= this.tickMs && steps.length < MAX_STEPS_PER_FRAME) {
      // Nothing to spend, or nothing to spare: the sim waits rather than banking the
      // time, or it would sprint through the backlog the moment one arrives.
      if (this.queue.length <= TARGET_BUFFER) {
        this.clockMs = Math.min(this.clockMs, this.tickMs);
        break;
      }
      this.clockMs -= this.tickMs;
      if (this.take(steps)) {
        break;
      }
    }

    // Too far behind to catch up on the clock alone.
    while (this.queue.length > MAX_BUFFER && steps.length < CATCHUP_STEPS_PER_FRAME) {
      if (this.take(steps)) {
        break;
      }
    }

    bufferedTurns.value = this.queue.length;
    return steps;
  }

  alpha(): number {
    return Math.min(1, this.clockMs / this.tickMs);
  }

  // An order from this client. It is not applied here and not applied now: it goes up, and
  // comes back down in the turn the server puts it in — the same turn, for everyone,
  // including the client that sent it. That round trip is what a lockstep click costs, and
  // paying it is what keeps the worlds equal.
  submit(command: WorldCommand): void {
    this.socket.send({ t: "command", command });
  }

  // Pause and speed belong to the host. The request goes up and the answer comes back in
  // the next turn's clock fields — nothing is written locally, because a client that
  // paused itself would be playing a different game one second later.
  setClock(command: ClockCommand): void {
    if (command.type === "togglePause") {
      // Toggled against the shared value, not a local one: `paused` here is the readout of
      // what the server last said.
      this.socket.send({ t: "clock", paused: !paused.value });
      return;
    }
    this.socket.send({ t: "clock", speed: command.value, paused: false });
  }

  private receive(message: ServerMessage): void {
    if (message.t === "turn") {
      if (this.received !== 0 && message.turn !== this.received + 1) {
        console.error(`lockstep: turn ${message.turn} arrived after ${this.received}`);
      }
      this.received = message.turn;
      this.applyClock(message.paused, message.speed);
      const commands: WorldCommand[] = [];
      for (const order of message.orders) {
        const command = parseCommand(order.command, seatOfPlayer(this.players, order.playerId));
        // Dropped identically on every client — see wire.ts.
        if (command) {
          commands.push(command);
        }
      }
      this.queue.push({ turn: message.turn, step: { commands, advance: message.advance } });
      return;
    }
    if (message.t === "waiting") {
      waitingFor.value = message.missing;
      return;
    }
    if (message.t === "desync") {
      // Nothing to repair: the worlds have already parted. Saying which turn is the only
      // useful act, because that turn is where the bug is.
      console.error(`lockstep: desync at turn ${message.turn}`, message.hashes);
      desyncedAt.value = message.turn;
    }
  }

  // The shared clock, as reported. Written into the signals so the HUD shows the game's
  // state rather than this client's opinion of it, and into `tickMs` so interpolation and
  // the tick rate agree — at 3× a tick lasts a third as long.
  private applyClock(nextPaused: boolean, nextSpeed: number): void {
    paused.value = nextPaused;
    speed.value = nextSpeed;
    this.tickMs = TICK_MS / Math.max(0.25, nextSpeed);
    waitingFor.value = [];
  }

  // Moves one turn from the queue into this frame's steps. Returns true when the batch has
  // to end here: the turn just taken is one this client owes a hash for, and the hash has
  // to be taken at that exact turn — every client hashing the same turn number is the
  // whole of how the comparison works. Two clients that batched differently and hashed at
  // 20 and 21 would never disagree, and never agree either.
  private take(steps: TurnStep[]): boolean {
    const queued = this.queue.shift();
    if (!queued) {
      return true;
    }
    steps.push(queued.step);
    this.executed = queued.turn;
    if (queued.turn >= this.nextHash) {
      this.hashDue = true;
      return true;
    }
    return false;
  }

  // Called at the top of a frame, which is the one moment the world is exactly at the end
  // of a turn: the engine applied the last batch before returning, and nothing has been
  // handed out since.
  private reportHash(): void {
    if (!this.hashDue) {
      return;
    }
    this.hashDue = false;
    this.nextHash = this.executed + HASH_EVERY;
    this.socket.send({ t: "hash", turn: this.executed, hash: hashWorld(this.world) });
  }
}

export { LockstepTurnSource };
