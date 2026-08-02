import type {
  GameStartMessage,
  ServerMessage,
  TurnMessage,
  TurnOrder,
  WireCommand,
} from "@hw/colony-sim-v1-protocol";

// The turn clock for one room — and still not a simulation.
//
// The server owns *when* a turn happens and *which orders are in it*, and knows
// nothing else about the game: it never reads a command, never holds an entity, never
// builds a world. That is the whole of lockstep's server side. Everything the players
// see is computed on their own machines from the seed and this sequence of turns, so
// the two things this file must get right are that every client receives the same
// orders in the same order, and that a turn is closed even when somebody is slow.
//
// The clock is here rather than on the clients on purpose. Classic peer lockstep waits
// for every player's orders before running a turn, which makes one lagging tab
// everyone's problem; here a late order simply lands in a later turn and nobody stops.
// What that costs is that "the tile I clicked at the moment I clicked it" becomes "the
// tile I clicked at the turn the order arrived" — for a colony sim, a trade worth
// making.

// One turn is one sim tick (core's TICK_MS). They are the same number because a turn
// *is* a tick: the clients have no clock of their own to reconcile with this one.
const TURN_MS = 100;

// Nobody's world is checked against nobody's: with one player attached the hashes have
// nothing to disagree with, and the game is a single-player one that happens to be
// networked.
const HASH_QUORUM = 2;

// How many turns of hash reports to keep. Two clients do not report the same turn at the
// same moment, and the gap between them is not small: a browser tab that is not on screen
// gets barely any frames, so its sim falls minutes behind the stream and then races
// through it. Both ends still report every turn they cross, so the window only has to
// outlive the lag — and a window too short does not report a desync, it simply stops
// comparing, which is the one failure this check must not have.
const HASH_WINDOW = 6000;

// A player who never loads in must not hold the others at the door forever. There is no
// late join, so their seat exists and simply never issues an order.
const START_TIMEOUT_MS = 20000;

// The transport, as the session sees it: something to send messages to, and something
// that can be told to go away. Keeping it this thin is what stops the WebSocket from
// leaking in here — the session is testable with two objects and no sockets.
interface Connection {
  playerId: string;
  send(message: ServerMessage): void;
  close(): void;
}

class GameSession {
  readonly roomId: string;
  // Seat order, frozen when the host pressed start: index in this list is the sim's
  // seat. It cannot be re-read from the room afterwards, or a player leaving would
  // renumber everyone else's colony mid-game.
  private readonly playerIds: string[];
  private readonly hostId: string;
  private readonly seed: number;
  private connections = new Map<string, Connection>();
  private turn = 0;
  private paused = false;
  private speed = 1;
  private inbox: TurnOrder[] = [];
  // Every turn ever sent. A client that attaches late gets the lot and fast-forwards
  // through it, which is also why this is a list and not a counter: it is the replay
  // log the design has been leaving the door open for, and rejoin will need exactly it.
  private log: TurnMessage[] = [];
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private hashes = new Map<number, Map<string, number>>();
  private reported = new Set<number>();
  private agreed = false;

  constructor(roomId: string, seed: number, playerIds: string[], hostId: string) {
    this.roomId = roomId;
    this.seed = seed;
    this.playerIds = [...playerIds];
    this.hostId = hostId;
  }

  // A client is here. Returns false for anyone who is not a participant — seats were
  // settled at start, and a spectator is not a thing this protocol has.
  attach(connection: Connection): boolean {
    if (!this.playerIds.includes(connection.playerId)) {
      return false;
    }
    // One connection per seat: a reloaded tab is the same player arriving again, and two
    // sockets under one id would double every order that player sends.
    this.connections.get(connection.playerId)?.close();
    this.connections.set(connection.playerId, connection);

    const start: GameStartMessage = {
      t: "start",
      seed: this.seed,
      players: this.playerIds,
      hostId: this.hostId,
      turnMs: TURN_MS,
      speed: this.speed,
      paused: this.paused,
    };
    connection.send(start);
    // Everything that has already happened, so this client's world is a function of the
    // same sequence as everyone else's rather than of the moment it opened the socket.
    for (const message of this.log) {
      connection.send(message);
    }
    this.tryStart();
    return true;
  }

  detach(playerId: string, connection: Connection): void {
    // A stale socket closing after its replacement arrived must not unseat the new one.
    if (this.connections.get(playerId) !== connection) {
      return;
    }
    this.connections.delete(playerId);
    if (this.connections.size === 0) {
      this.stop();
    }
  }

  get empty(): boolean {
    return this.connections.size === 0;
  }

  // The room was started again — a second game on the same room id. The old one's
  // clients are cut rather than left running: their world was a function of a turn
  // stream nobody is feeding any more, and letting them play on would be two games
  // wearing one room's name.
  detachAll(): void {
    this.stop();
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
  }

  // An order from a client. The sender comes from the connection, not from the message
  // — see TurnOrder.
  order(playerId: string, command: WireCommand): void {
    this.inbox.push({ playerId, command });
  }

  // The shared clock. Host only: one clock needs one owner, and dropping the request
  // silently is deliberate — the guest's HUD shows the clock the turns report, so a
  // button that answered locally would be lying rather than merely doing nothing.
  clock(playerId: string, next: { paused?: boolean; speed?: number }): void {
    if (playerId !== this.hostId) {
      return;
    }
    if (typeof next.paused === "boolean") {
      this.paused = next.paused;
    }
    if (typeof next.speed === "number" && next.speed > 0) {
      const speed = Math.min(8, Math.max(0.25, next.speed));
      if (speed !== this.speed) {
        this.speed = speed;
        // The interval is derived from the speed, so it has to be re-armed rather than
        // waited out: at 3× the next turn is due long before the 1× timer would fire.
        this.rearm();
      }
    }
  }

  // What one client says its world looked like at the end of a turn. Compared as soon as
  // enough clients have spoken for the same turn, and never repaired: a desync is a bug
  // in the sim, and the only useful thing to do with it is to say so while it is still
  // one turn old.
  hash(playerId: string, turn: number, hash: number): void {
    let forTurn = this.hashes.get(turn);
    if (!forTurn) {
      forTurn = new Map();
      this.hashes.set(turn, forTurn);
    }
    forTurn.set(playerId, hash);
    this.pruneHashes(turn);

    if (forTurn.size < Math.max(HASH_QUORUM, this.connections.size)) {
      return;
    }
    const values = [...forTurn.values()];
    if (values.every((value) => value === values[0])) {
      // Once, on the first turn the clients agreed about: a desync check that is silently
      // not running looks exactly like a game that never desyncs, and the difference
      // matters enough to say out loud one time.
      if (!this.agreed) {
        this.agreed = true;
        console.log(`room ${this.roomId}: worlds agree at turn ${turn}`);
      }
      return;
    }
    if (this.reported.has(turn)) {
      return;
    }
    this.reported.add(turn);
    const hashes: Record<string, number> = {};
    for (const [id, value] of forTurn) {
      hashes[id] = value;
    }
    console.error(`desync in room ${this.roomId} at turn ${turn}:`, hashes);
    this.broadcast({ t: "desync", turn, hashes });
  }

  private tryStart(): void {
    if (this.running) {
      return;
    }
    const missing = this.playerIds.filter((id) => !this.connections.has(id));
    if (missing.length === 0) {
      this.begin();
      return;
    }
    this.broadcast({ t: "waiting", missing });
    if (!this.startTimer) {
      this.startTimer = setTimeout(() => this.begin(), START_TIMEOUT_MS);
    }
  }

  private begin(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    console.log(`room ${this.roomId}: turn clock started for ${this.connections.size}/${this.playerIds.length} players`);
    this.rearm();
  }

  private rearm(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    if (!this.running) {
      return;
    }
    // setTimeout chained rather than setInterval: the interval is a function of the
    // shared speed, and re-arming one timeout is the whole of changing gear.
    this.turnTimer = setTimeout(() => {
      this.closeTurn();
      this.rearm();
    }, Math.max(10, Math.round(TURN_MS / this.speed)));
  }

  // The deadline passed: whatever arrived is this turn, and it is the same turn for
  // everyone because it is serialised once, here.
  private closeTurn(): void {
    // A paused game with nothing to say says nothing — no point numbering thousands of
    // empty turns while the players talk. Orders still go out while paused, carrying
    // `advance: false`: they land on a frozen world, which is what a spawn button on a
    // paused game has always done.
    if (this.paused && this.inbox.length === 0) {
      return;
    }
    this.turn += 1;
    const message: TurnMessage = {
      t: "turn",
      turn: this.turn,
      advance: !this.paused,
      speed: this.speed,
      paused: this.paused,
      orders: this.inbox,
    };
    this.inbox = [];
    this.log.push(message);
    this.broadcast(message);
  }

  private pruneHashes(latest: number): void {
    const oldest = latest - HASH_WINDOW;
    for (const turn of this.hashes.keys()) {
      if (turn < oldest) {
        this.hashes.delete(turn);
        this.reported.delete(turn);
      }
    }
  }

  private stop(): void {
    this.running = false;
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const connection of this.connections.values()) {
      connection.send(message);
    }
  }
}

// Sessions live in memory beside the rooms, and for the same reasons — see lobby.ts. A
// session outlives its room on purpose: the room is a waiting list, and the players
// walking out of the lobby into the game is exactly when it stops mattering.
const sessions = new Map<string, GameSession>();

function startSession(roomId: string, seed: number, playerIds: string[], hostId: string): GameSession {
  sessions.get(roomId)?.detachAll();
  const session = new GameSession(roomId, seed, playerIds, hostId);
  sessions.set(roomId, session);
  return session;
}

function getSession(roomId: string): GameSession | null {
  return sessions.get(roomId) ?? null;
}

function dropEmptySession(roomId: string): void {
  const session = sessions.get(roomId);
  if (session?.empty) {
    sessions.delete(roomId);
  }
}

export type { Connection };
export { dropEmptySession, GameSession, getSession, startSession, TURN_MS };
