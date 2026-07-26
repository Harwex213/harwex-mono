import type { ClientMessage, GameStartMessage, ServerMessage } from "@hw/colony-sim-v1-protocol";
import { disconnected } from "./status";

// The game's connection, and nothing above it: it opens, it waits for the terms of the
// match, and from then on it is a pipe with a mailbox.
//
// The mailbox is the part worth explaining. `start` arrives immediately, but the client
// cannot begin playing on it — pixi's init is asynchronous and takes a moment, and turns
// are already coming down the wire in that moment. So every message after `start` is kept
// until someone subscribes, and then replayed in order. Dropping them instead would mean
// starting the sim at turn 40 with the world of turn 0, which is not a lag — it is a
// different game.

interface GameSocket {
  start: GameStartMessage;
  // Takes over the mailbox: the backlog first, then everything as it arrives.
  listen(handler: (message: ServerMessage) => void): void;
  send(message: ClientMessage): void;
  close(): void;
}

function socketUrl(roomId: string, playerId: string): string {
  const scheme = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
  const query = `roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}`;
  // Same origin as everything else the client calls, so dev proxies it and the deploy
  // needs no host configured — see api.ts.
  return `${scheme}//${globalThis.location.host}/api/game?${query}`;
}

// Resolves once the server has stated the terms of the match, rejects if the socket dies
// first — which is what a room that was never started, or a seat that is not this
// player's, looks like from here.
function openGameSocket(roomId: string, playerId: string): Promise<GameSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl(roomId, playerId));
    let handler: ((message: ServerMessage) => void) | null = null;
    const backlog: ServerMessage[] = [];
    let started = false;

    socket.onmessage = (event: MessageEvent<string>) => {
      const message: ServerMessage = JSON.parse(event.data);
      if (!started && message.t === "start") {
        started = true;
        resolve({
          start: message,
          listen: (next) => {
            handler = next;
            for (const queued of backlog.splice(0)) {
              next(queued);
            }
          },
          send: (outgoing: ClientMessage) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify(outgoing));
            }
          },
          close: () => socket.close(),
        });
        return;
      }
      if (handler) {
        handler(message);
        return;
      }
      backlog.push(message);
    };

    socket.onclose = () => {
      if (!started) {
        reject(new Error("the game session is not open"));
        return;
      }
      // Mid-game: there is no rejoin, so this is terminal. Said out loud rather than
      // handled, because a world that stops receiving turns simply stops.
      disconnected.value = true;
    };
    // An error is always followed by a close, so the close handler is the only one that
    // has to do anything.
    socket.onerror = () => {};
  });
}

export type { GameSocket };
export { openGameSocket };
