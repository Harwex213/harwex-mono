import { signal } from "@preact/signals";
import { DEFAULT_PLAYER, PLAYER_IDS, type PlayerId } from "@hw/colony-sim-v1-core";
import type { LobbyPlayer, LobbyRoom } from "@hw/colony-sim-v1-protocol";
import { openLobbyStream } from "./api";

// The client's view of the lobby: a mirror of the server's, never a second copy of
// the truth. Nothing writes `rooms` except the event stream, so a command's effect
// is only visible once the server has confirmed it by pushing the new snapshot back.
// That is what keeps this tab and the next one from disagreeing about who is waiting
// where.
const rooms = signal<LobbyRoom[]>([]);
// Everyone holding a stream open, in a room or not. Two signals rather than one
// event object: the lobby list and the online panel re-render on different changes,
// and a single object would repaint both every time either moved.
const onlinePlayers = signal<LobbyPlayer[]>([]);
// Non-null while the stream is down. EventSource reconnects on its own, so this is
// something to show, not something to act on.
const lobbyError = signal<string | null>(null);

let close: (() => void) | null = null;

function connectLobby(playerId: string): void {
  disconnectLobby();
  close = openLobbyStream(playerId, {
    onLobby: (event) => {
      rooms.value = event.rooms;
      onlinePlayers.value = event.players;
      lobbyError.value = null;
    },
    onError: () => {
      lobbyError.value = "connection lost — reconnecting…";
    },
  });
}

function disconnectLobby(): void {
  close?.();
  close = null;
  rooms.value = [];
  onlinePlayers.value = [];
}

// A non-reactive lookup, for callers outside the Preact tree. Reading `rooms.value`
// there would subscribe an effect to every lobby change it does not care about.
function findRoom(roomId: string): LobbyRoom | null {
  return rooms.peek().find((room) => room.id === roomId) ?? null;
}

// Which colony in the sim this player runs. The room lists its members in join
// order, host first, and every client gets that same server snapshot — so the seat
// is the same everywhere without anyone having to agree on it separately. A room
// holding more players than the sim has colonies seats the extras with the first
// one; there is nowhere else to put them until the sim grows more.
function seatOf(room: LobbyRoom, playerId: string): PlayerId {
  const index = room.players.findIndex((player) => player.id === playerId);
  return PLAYER_IDS[index] ?? DEFAULT_PLAYER;
}

export { connectLobby, disconnectLobby, findRoom, lobbyError, onlinePlayers, rooms, seatOf };
