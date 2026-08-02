import { signal } from "@preact/signals";

// What the network is doing to the game, for the one banner over the canvas.
//
// Separate from the lobby's `lobbyError` because it says a different kind of thing: the
// lobby reconnects on its own and a gap there is cosmetic, while a game whose turn stream
// stopped is a game that has stopped. Nothing here is actionable by the code — it is all
// for the player, who is otherwise looking at a world that quietly froze.

// Players the server is still waiting to load in before turn one.
const waitingFor = signal<string[]>([]);
// The turn at which two clients reported different worlds, once it has happened. Sticky:
// a desync does not heal, and the number is the only thing that will help anyone find it.
const desyncedAt = signal<number | null>(null);
// The socket is gone. Without turns the sim cannot advance at all, so this is the end of
// the game rather than a hiccup — there is no rejoin yet.
const disconnected = signal(false);
// Turns buffered ahead of the sim. Not shown, but the one number that says whether this
// client is keeping up; handy in the console when a game feels sticky.
const bufferedTurns = signal(0);

function resetNetStatus(): void {
  waitingFor.value = [];
  desyncedAt.value = null;
  disconnected.value = false;
  bufferedTurns.value = 0;
}

export { bufferedTurns, desyncedAt, disconnected, resetNetStatus, waitingFor };
