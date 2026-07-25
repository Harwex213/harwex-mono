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

export type { ErrorResponse, LobbyEvent, LobbyPlayer, LobbyRoom, SessionResponse };
