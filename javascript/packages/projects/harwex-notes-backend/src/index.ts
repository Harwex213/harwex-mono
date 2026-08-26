import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { appRouter } from "./router/index.js";
import { createContext } from "./trpc.js";

const port = Number(process.env.PORT ?? 3001);

const server = createHTTPServer({
  router: appRouter,
  createContext,
  middleware: (_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (_req.method === "OPTIONS") {
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
