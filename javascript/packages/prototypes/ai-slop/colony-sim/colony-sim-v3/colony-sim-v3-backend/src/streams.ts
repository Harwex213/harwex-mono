import type { IncomingMessage, ServerResponse } from "node:http";
import { markOnline, removePlayer, snapshot } from "./lobby.ts";

// Server-sent events, not websockets: the lobby only ever pushes downstream, and
// everything a client wants to say it says with a POST. SSE is one-directional by
// nature, reconnects on its own in the browser, and needs no protocol on top.
const KEEPALIVE_MS = 25000;

interface Stream {
  playerId: string;
  response: ServerResponse;
}

const streams = new Set<Stream>();

// One timer for every client rather than one per client. Proxies drop connections
// that go quiet; a comment line is the cheapest thing that keeps them open.
const keepalive = setInterval(() => {
  for (const stream of streams) {
    stream.response.write(":\n\n");
  }
}, KEEPALIVE_MS);
// Never a reason to hold the process open on its own.
keepalive.unref();

function openStream(playerId: string, request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    // Tells nginx (and the dev-server proxy) not to buffer: buffered events arrive
    // in a batch when the connection closes, which is the opposite of the point.
    "x-accel-buffering": "no",
  });
  // Node closes idle sockets by default; an event stream is idle by design.
  request.socket.setTimeout(0);
  request.socket.setNoDelay(true);

  const stream: Stream = { playerId, response };
  streams.add(stream);
  // Opening the stream is what puts the player online, so the rest of the lobby has
  // to hear about it — including this client, which gets the snapshot it is in.
  markOnline(playerId);
  broadcast();

  // The connection *is* the player's presence — see lobby.ts. Dropping it is how
  // closing a tab removes them from their room.
  response.on("close", () => {
    streams.delete(stream);
    removePlayer(playerId);
    broadcast();
  });
}

// Everyone gets the same bytes, so the snapshot is built and serialised once.
function broadcast(): void {
  const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const stream of streams) {
    stream.response.write(payload);
  }
}

export { broadcast, openStream };
