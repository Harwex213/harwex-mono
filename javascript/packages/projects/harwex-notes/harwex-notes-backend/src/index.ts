import { createHTTPServer } from "@trpc/server/adapters/standalone";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FsDataAccess } from "./data-access/fs-data-access.js";
import { createMemoryVaultFs } from "./data-access/memory-vault-fs.js";
import { createNodeVaultFs } from "./data-access/node-vault-fs.js";
import { SAMPLE_VAULT, SAMPLE_VAULT_PATH } from "./data-access/sample-vault.js";
import { appRouter } from "./router/index.js";
import { createStaticMiddleware } from "./static-middleware.js";
import type { TContext } from "./trpc.js";

const DEFAULT_PORT = 4001;
const API_PREFIX = "/api";
const DEFAULT_STATIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../static");

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const vaultPath = process.env.VAULT_PATH;
const staticDir = process.env.STATIC_DIR ?? DEFAULT_STATIC_DIR;

const dataAccess = ((): FsDataAccess => {
  if (vaultPath === undefined || vaultPath.length === 0) {
    console.log("VAULT_PATH is not set: serving the in-memory sample vault");

    return new FsDataAccess(createMemoryVaultFs(SAMPLE_VAULT_PATH, SAMPLE_VAULT), SAMPLE_VAULT_PATH);
  }

  return new FsDataAccess(createNodeVaultFs(), vaultPath);
})();

const createContext = (): TContext => {
  return { dataAccess };
};

const serveStatic = createStaticMiddleware({ rootDir: staticDir, apiPrefix: API_PREFIX });

const server = createHTTPServer({
  router: appRouter,
  createContext,
  basePath: `${API_PREFIX}/`,
  middleware: (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    serveStatic(req, res, next);
  },
});

try {
  await dataAccess.preload();
} catch (error) {
  console.error(`Cannot open the vault: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

server.listen(port, () => {
  console.log(`harwex-notes-backend listening on http://localhost:${port}`);
  console.log(`  api:    http://localhost:${port}${API_PREFIX}`);
  console.log(`  static: ${staticDir}`);
});
