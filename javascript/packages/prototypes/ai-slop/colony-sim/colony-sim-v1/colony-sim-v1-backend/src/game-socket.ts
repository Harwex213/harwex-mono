import type { Server } from "node:http";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@hw/colony-sim-v1-protocol";
import { type Connection, dropEmptySession, getSession } from "./game.ts";

// The game's transport, and the one place in the backend that is not SSE.
//
// The lobby broadcasts downhill and takes commands by POST, which is all a waiting room
// needs. A turn clock does not fit that: orders go up ten times a second and turns come
// down ten times a second, and a POST per order buys nothing but a connection setup per
// click. So the game gets a socket, and the lobby keeps its stream — two channels
// because they carry two different things, not because one of them was old.
//
// Everything here is plumbing: parse a frame, hand it to the session, serialise what the
// session sends back. No decision about the game is taken in this file.

const PING_MS = 20000;

// Frames big enough to be an attack rather than an order. A turn's worth of orders from
// one client is a handful of small objects; anything past this is not one.
const MAX_FRAME_BYTES = 64 * 1024;

function readMessage(data: RawData): ClientMessage | null {
  const text = typeof data === "string" ? data : data.toString();
  if (text.length > MAX_FRAME_BYTES) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !("t" in parsed)) {
      return null;
    }
    return parsed as ClientMessage;
  } catch {
    return null;
  }
}

function attachGameSockets(server: Server): void {
  const sockets = new WebSocketServer({ server, path: "/api/game" });

  sockets.on("connection", (socket: WebSocket, request) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const playerId = url.searchParams.get("playerId");
    const roomId = url.searchParams.get("roomId");
    const session = roomId ? getSession(roomId) : null;
    // No game to join, or not a player in it. Closing rather than answering is the whole
    // error protocol here: the client cannot do anything with the reason, and the room
    // page is where a player belongs until the host has started.
    if (!playerId || !roomId || !session) {
      socket.close();
      return;
    }

    const connection: Connection = {
      playerId,
      send: (message: ServerMessage) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      },
      close: () => socket.close(),
    };
    if (!session.attach(connection)) {
      socket.close();
      return;
    }

    socket.on("message", (data: RawData) => {
      const message = readMessage(data);
      if (!message) {
        return;
      }
      if (message.t === "command") {
        session.order(playerId, message.command);
        return;
      }
      if (message.t === "clock") {
        session.clock(playerId, { paused: message.paused, speed: message.speed });
        return;
      }
      if (message.t === "hash" && typeof message.turn === "number" && typeof message.hash === "number") {
        session.hash(playerId, message.turn, message.hash);
      }
    });

    socket.on("close", () => {
      session.detach(playerId, connection);
      dropEmptySession(roomId);
    });
    // A socket that errors is a socket that is about to close; without this the error is
    // unhandled and takes the process down with it.
    socket.on("error", () => socket.close());
  });

  // Proxies and load balancers drop connections that go quiet, and a paused game is
  // quiet by design. ws answers pongs itself, so a ping is the whole keepalive.
  const ping = setInterval(() => {
    for (const socket of sockets.clients) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping();
      }
    }
  }, PING_MS);
  ping.unref();
}

export { attachGameSockets };
