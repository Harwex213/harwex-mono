// What the client and the server agree on, and nothing else. Types only, on
// purpose: the backend runs its sources through Node's type stripping, which
// refuses to load TypeScript out of node_modules — a runtime import of this package
// would resolve there through the workspace symlink. `import type` erases before
// Node ever sees it, so both sides can share the shape without either loading the
// file.
//
// Wire shapes belong here rather than in either app: two copies of a DTO drift, and
// the drift shows up as a field that is silently undefined on one side.

// A player exists for as long as their event stream is open. There is no account
// and no token — the id is a handle the server hands out, not an identity it can
// vouch for.
interface LobbyPlayer {
  id: string;
  name: string;
}

// A room is who is waiting and with what seed. It is not game state: the world is
// built from the seed by the simulation, on each client.
interface LobbyRoom {
  id: string;
  name: string;
  seed: number;
  hostId: string;
  players: LobbyPlayer[];
  started: boolean;
}

interface SessionResponse {
  playerId: string;
  name: string;
}

// The one push message. The server always sends the whole lobby rather than a diff:
// at this size a full snapshot is cheaper than the bookkeeping a diff would need,
// and a client that missed a message cannot end up in a wrong state.
//
// `players` is everyone online — which here means everyone holding an event stream
// open, room or no room. It is not the union of the rooms' players: standing in the
// lobby counts.
interface LobbyEvent {
  rooms: LobbyRoom[];
  players: LobbyPlayer[];
}

interface ErrorResponse {
  error: string;
}

// ---------------------------------------------------------------------------
// The lockstep game session.
//
// The server owns the turn clock and nothing else about the game: it batches whatever
// orders arrived since the last deadline, stamps who sent them, numbers the turn and
// sends the same bytes to everyone. Every client then runs the same deterministic sim
// over the same sequence, so the worlds stay equal without a single entity ever
// crossing the wire.
//
// The clock is the server's rather than the clients' by agreement between them, so one
// slow player cannot stop the game: a late order lands in a later turn, and nobody
// waits. What that costs is the honesty of "your click happened at turn N" — it
// happened at the turn the server was on when it arrived.
// ---------------------------------------------------------------------------

// One order, as it travels. Opaque on purpose: the server relays commands and never
// reads one, and giving this a shape would put the sim's command union into the lobby
// server's types — along with a dependency on core, which this package must not have
// and the backend could not even load. The client narrows it back on arrival, and has
// to: the sender is another build of the game, not a trusted caller.
type WireCommand = unknown;

// An order with its sender. The id is stamped by the server from the connection it
// came in on, never read out of the message: whose colony an order builds in is not
// something a client gets to write.
interface TurnOrder {
  playerId: string;
  command: WireCommand;
}

// Tick zero: everything the clients must agree on before the first turn. Seats are
// pinned here as an ordered list — index in it *is* the sim's seat — so a player
// leaving mid-game cannot renumber anyone's colony behind their back.
interface GameStartMessage {
  t: "start";
  seed: number;
  players: string[];
  // Who owns the clock. Not a permission the server needs restating — it enforces that
  // itself — but the clients do: a pause button that answered nobody would read as
  // broken, so a guest's is disabled instead.
  hostId: string;
  turnMs: number;
  speed: number;
  paused: boolean;
}

// Still waiting for someone to load in. Sent instead of the first turn: with no late
// join, a game that started without a player would leave them a seat that never issues
// an order.
interface GameWaitingMessage {
  t: "waiting";
  missing: string[];
}

// One turn — the unit the world is a function of.
//
// `turn` is a sequence number, not a tick. A paused game still delivers orders (a
// spawn dropped on a frozen world has to land) and those turns carry `advance: false`,
// so turns and ticks part company while the game is paused — identically on every
// client, which is all that matters.
interface TurnMessage {
  t: "turn";
  turn: number;
  advance: boolean;
  // The shared clock, restated every turn rather than announced once: a client that
  // renders between turns needs to know how long a tick lasts, and a paused game is
  // the only thing that makes speed worth resending.
  speed: number;
  paused: boolean;
  orders: TurnOrder[];
}

// Two clients reported different worlds for the same turn. Nothing is repaired — the
// point is to say so loudly, because the alternative is two games drifting apart while
// both look plausible.
interface DesyncMessage {
  t: "desync";
  turn: number;
  hashes: Record<string, number>;
}

// An order this client wants in the next turn the server closes.
interface CommandMessage {
  t: "command";
  command: WireCommand;
}

// Pause or speed. Host only: the clock is one thing for everyone, so it needs one
// owner, and the room already has one. A request from anyone else is dropped rather
// than answered — see the backend.
interface ClockMessage {
  t: "clock";
  paused?: boolean;
  speed?: number;
}

// What this client's world looked like at the end of `turn`. Sent every few turns, and
// the only reason a desync is ever noticed at all.
interface HashMessage {
  t: "hash";
  turn: number;
  hash: number;
}

type ClientMessage = ClockMessage | CommandMessage | HashMessage;
type ServerMessage = DesyncMessage | GameStartMessage | GameWaitingMessage | TurnMessage;

export type {
  ClientMessage,
  ClockMessage,
  CommandMessage,
  DesyncMessage,
  ErrorResponse,
  GameStartMessage,
  GameWaitingMessage,
  HashMessage,
  LobbyEvent,
  LobbyPlayer,
  LobbyRoom,
  ServerMessage,
  SessionResponse,
  TurnMessage,
  TurnOrder,
  WireCommand,
};
