import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { SessionResponse } from "@hw/colony-sim-v1-protocol";
import { readJson, requireString, sendJson } from "./http.ts";
import { addPlayer, createRoom, joinRoom, leaveRoom, LobbyError, startRoom } from "./lobby.ts";
import { broadcast, openStream } from "./streams.ts";

// The lobby server: sessions, rooms, and the event stream that keeps every client's
// view of them current. `node src/index.ts` — Node strips the types itself, so the
// package still has no dependencies and no build step.
//
// Deliberately empty of game logic. The one game-shaped thing it owns is the seed,
// and it owns that precisely because it is the one number every player in a room
// must receive identically. Whatever else the client and server come to share
// belongs in the protocol package, not in a second copy of the simulation.
const DEFAULT_PORT = 8787;

const port = Number.parseInt(process.env.PORT ?? "", 10) || DEFAULT_PORT;

// Rooms are the only path parameter in the API, so one pattern covers the routing.
const ROOM_ACTION = /^\/api\/rooms\/([^/]+)\/(join|leave|start)$/;

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if (method === "GET" && path === "/health") {
    sendJson(response, 200, { status: "ok", uptime: process.uptime() });
    return;
  }

  // Sign in. There is no password and no token: the id is a handle, and it is only
  // as good as the connection that follows it.
  if (method === "POST" && path === "/api/session") {
    const body = await readJson(request);
    const player = addPlayer(requireString(body, "name"));
    const session: SessionResponse = { playerId: player.id, name: player.name };
    sendJson(response, 200, session);
    return;
  }

  // The only read path. Everything else is a command, and the result of a command
  // reaches every client — including the one that sent it — through here.
  if (method === "GET" && path === "/api/stream") {
    const playerId = url.searchParams.get("playerId");
    if (!playerId) {
      sendJson(response, 400, { error: "playerId is required" });
      return;
    }
    openStream(playerId, request, response);
    return;
  }

  if (method === "POST" && path === "/api/rooms") {
    const body = await readJson(request);
    const room = createRoom(requireString(body, "playerId"));
    broadcast();
    sendJson(response, 201, { id: room.id });
    return;
  }

  const action = ROOM_ACTION.exec(path);
  if (method === "POST" && action) {
    const [, roomId, verb] = action;
    const body = await readJson(request);
    const playerId = requireString(body, "playerId");
    if (verb === "join") {
      joinRoom(roomId, playerId);
    } else if (verb === "leave") {
      leaveRoom(roomId, playerId);
    } else {
      startRoom(roomId, playerId);
    }
    broadcast();
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: "not found" });
}

// One place turns a thrown lobby rule into a status code, so the routes above can
// stay a list of operations.
function handle(request: IncomingMessage, response: ServerResponse): void {
  void route(request, response).catch((error: unknown) => {
    if (response.headersSent) {
      response.end();
      return;
    }
    const status = error instanceof LobbyError ? error.status : 400;
    sendJson(response, status, { error: error instanceof Error ? error.message : "bad request" });
  });
}

const server = createServer(handle);

server.listen(port, () => {
  console.log(`colony-sim-v1 backend listening on http://localhost:${port}`);
});

// Without this a Ctrl-C under `node --watch` leaves the port held by the old
// process. Event streams never end on their own, so they have to be cut explicitly:
// close() alone waits for them and the shutdown hangs.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
}
