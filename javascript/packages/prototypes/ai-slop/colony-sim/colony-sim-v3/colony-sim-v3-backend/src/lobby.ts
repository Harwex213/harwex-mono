import type { LobbyEvent, LobbyPlayer, LobbyRoom } from "@hw/colony-sim-v3-protocol";

// The lobby, held in memory and nowhere else. Restarting the server empties it, and
// that is the intended trade for this stage: a room is a handful of names waiting on
// each other for a few minutes, so durability would cost more than losing it does.
// The day it must survive a restart, only this file changes — the routes hand it
// commands and ask it for a snapshot, and never reach into these Maps.
//
// Still no game logic here. A room says who is waiting and with what seed; the world
// that seed describes is built by the simulation on each client.
class LobbyError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Room {
  id: string;
  name: string;
  seed: number;
  hostId: string;
  // Ids, not names: a player renamed (or dropped) in one place must not stay stale
  // in another. Names are resolved once, when the snapshot is built.
  playerIds: string[];
  started: boolean;
}

const players = new Map<string, LobbyPlayer>();
const rooms = new Map<string, Room>();
// Signing in registers a player; opening the event stream is what puts them online.
// The two are apart by one round trip normally, and forever for a session that asked
// for an id and never came back — which is exactly what must not show up as online.
const online = new Set<string>();

function addPlayer(name: string): LobbyPlayer {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new LobbyError(400, "name is required");
  }
  const player: LobbyPlayer = { id: crypto.randomUUID(), name: trimmed.slice(0, 24) };
  players.set(player.id, player);
  return player;
}

function requirePlayer(playerId: string): LobbyPlayer {
  const player = players.get(playerId);
  if (!player) {
    // The client's session is in memory too, so this is what a server restart looks
    // like from the outside: sign in again.
    throw new LobbyError(401, "unknown player");
  }
  return player;
}

function requireRoom(roomId: string): Room {
  const room = rooms.get(roomId);
  if (!room) {
    throw new LobbyError(404, "room not found");
  }
  return room;
}

function createRoom(playerId: string): Room {
  const host = requirePlayer(playerId);
  const room: Room = {
    id: crypto.randomUUID(),
    name: `${host.name}'s colony`,
    // The seed is minted here rather than on a client: it is the one thing every
    // player in the room has to receive identically, and only the server can say so.
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    hostId: host.id,
    playerIds: [host.id],
    started: false,
  };
  rooms.set(room.id, room);
  return room;
}

// Idempotent: entering a room is also what a reload does, and it must not double the
// player.
function joinRoom(roomId: string, playerId: string): Room {
  const player = requirePlayer(playerId);
  const room = requireRoom(roomId);
  if (!room.playerIds.includes(player.id)) {
    room.playerIds.push(player.id);
  }
  return room;
}

function leaveRoom(roomId: string, playerId: string): void {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }
  dropFromRoom(room, playerId);
}

function startRoom(roomId: string, playerId: string): Room {
  const room = requireRoom(roomId);
  if (room.hostId !== playerId) {
    throw new LobbyError(403, "only the host can start the game");
  }
  room.started = true;
  return room;
}

function markOnline(playerId: string): void {
  if (players.has(playerId)) {
    online.add(playerId);
  }
}

// A player lives exactly as long as their event stream. That is what makes the
// player counts honest without a heartbeat protocol: closing the tab drops the
// connection, and the connection is the presence.
function removePlayer(playerId: string): void {
  players.delete(playerId);
  online.delete(playerId);
  for (const room of [...rooms.values()]) {
    dropFromRoom(room, playerId);
  }
}

function dropFromRoom(room: Room, playerId: string): void {
  room.playerIds = room.playerIds.filter((id) => id !== playerId);
  if (room.playerIds.length === 0) {
    rooms.delete(room.id);
    return;
  }
  // The host left but the room did not: someone has to be able to start it.
  if (room.hostId === playerId) {
    room.hostId = room.playerIds[0];
  }
}

// The whole lobby, with names resolved — this is the push message itself, so the
// stream has nothing left to assemble. Rooms whose players all vanished are already
// gone, so nothing here can reference a player that no longer exists.
function snapshot(): LobbyEvent {
  const openRooms = [...rooms.values()].map((room) => {
    return {
      id: room.id,
      name: room.name,
      seed: room.seed,
      hostId: room.hostId,
      players: room.playerIds.map((id) => players.get(id)).filter((player) => player !== undefined),
      started: room.started,
    } satisfies LobbyRoom;
  });
  const onlinePlayers = [...online].map((id) => players.get(id)).filter((player) => player !== undefined);
  return { rooms: openRooms, players: onlinePlayers };
}

export type { Room };
export { addPlayer, createRoom, joinRoom, leaveRoom, LobbyError, markOnline, removePlayer, snapshot, startRoom };
