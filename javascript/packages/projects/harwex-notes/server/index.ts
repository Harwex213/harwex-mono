import { createHTTPServer } from "@trpc/server/adapters/standalone";
import process from "node:process";
import { appRouter } from "./router.ts";
import { notesRoot } from "./workspace.ts";

const PORT = Number(process.env.NOTES_API_PORT ?? 5788);
const HOST = "127.0.0.1";

const server = createHTTPServer({
  router: appRouter,
  // The rspack dev server proxies `/trpc`, so the adapter has to strip the
  // same prefix before it looks for a procedure name.
  basePath: "/trpc/",
});

// A fixed port is a deliberate trade: the proxy target must be a known number.
// If something else already holds it, say so instead of half-starting.
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    process.stderr.write(
      `Port ${PORT} is already in use. Stop the other process or set NOTES_API_PORT.\n`,
    );
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`harwex-notes api on http://${HOST}:${PORT}/trpc\n`);
  process.stdout.write(`notes root: ${notesRoot()}\n`);
});
