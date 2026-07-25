import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

// Placeholder server: one healthcheck, no dependencies, `node src/index.ts` (Node
// strips the types itself). It exists so the deploy story and the client's notion of
// "where the backend is" can be settled before there is anything to save there.
//
// Deliberately empty of game logic: whatever the client and the server come to share
// belongs in a package both can import, not in a second copy of the simulation.
const DEFAULT_PORT = 8787;

const port = Number.parseInt(process.env.PORT ?? "", 10) || DEFAULT_PORT;

function handle(request: IncomingMessage, response: ServerResponse): void {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
}

const server = createServer(handle);

server.listen(port, () => {
  console.log(`colony-sim-v1 backend listening on http://localhost:${port}`);
});

// Without this a Ctrl-C under `node --watch` leaves the port held by the old process.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
