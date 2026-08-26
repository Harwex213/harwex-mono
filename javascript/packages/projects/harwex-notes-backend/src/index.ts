import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { createFsStore } from "./fsStore.js";
import { appRouter } from "./router/index.js";
import type { TContext } from "./trpc.js";

const DEFAULT_PORT = 3001;

const port = Number(process.env.PORT ?? DEFAULT_PORT);

// One store for the whole process: the vault is shared by every client.
const fs = createFsStore();

const createContext = (): TContext => {
  return { fs };
};

const server = createHTTPServer({
  router: appRouter,
  createContext,
  middleware: (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    next();
  },
});

server.listen(port, () => {
  console.log(`harwex-notes-backend listening on http://localhost:${port}`);
});
