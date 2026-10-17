import { createHTTPServer } from "@trpc/server/adapters/standalone";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FsDataAccess } from "./data-access/fs-data-access.js";
import { createMemoryVaultFs } from "./data-access/memory-vault-fs.js";
import { createNodeVaultFs } from "./data-access/node-vault-fs.js";
import { SAMPLE_VAULT, SAMPLE_VAULT_PATH } from "./data-access/sample-vault.js";
import { openStateDb, readStateDbLocation } from "./data-access/state-db.js";
import { StateStore } from "./data-access/state-store.js";
import { isOpaqueOriginAssetLoad, isSameOriginRequest } from "./origin-guard.js";
import { createRawMiddleware } from "./raw-middleware.js";
import { appRouter } from "./router/index.js";
import { RAW_URL_PREFIX } from "./service/raw-service.js";
import { createVaultChanges, startVaultSync } from "./service/sync-service.js";
import { createStaticMiddleware } from "./static-middleware.js";
import type { ServerResponse } from "node:http";
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

const stateDbLocation = readStateDbLocation({ stateDbPath: process.env.STATE_DB_PATH, vaultPath });

// UI state never blocks the vault (SESS-8): a database that does not open is replaced by
// an in-memory one, and the app starts at its defaults.
const stateStore = ((): StateStore => {
  try {
    return new StateStore(openStateDb(stateDbLocation));
  } catch (error) {
    console.error(`Cannot open the state database at ${stateDbLocation}: ${error instanceof Error ? error.message : String(error)}`);
    console.error("UI state is kept in memory until the next start");

    return new StateStore(openStateDb(":memory:"));
  }
})();

const vaultChanges = createVaultChanges();

const createContext = (): TContext => {
  return { dataAccess, stateStore, vaultChanges };
};

const refuse = (res: ServerResponse) => {
  res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Requests from another origin are refused");
};

const serveStatic = createStaticMiddleware({ rootDir: staticDir, apiPrefix: API_PREFIX });
const serveRaw = createRawMiddleware(dataAccess);

const server = createHTTPServer({
  router: appRouter,
  createContext,
  basePath: `${API_PREFIX}/`,
  middleware: (req, res, next) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

    // Raw files are open to any page as plain loads, the way a vault page needs its own
    // assets. Another origin cannot read them as data: there is no CORS answer for that.
    if (pathname.startsWith(`${RAW_URL_PREFIX}/`)) {
      res.setHeader("Vary", "Origin");
      if (isOpaqueOriginAssetLoad(req)) {
        res.setHeader("Access-Control-Allow-Origin", "*");
      }

      serveRaw(req, res);

      return;
    }

    // No CORS headers are ever sent for the api, so a browser also refuses a preflight
    // from another origin. The check below covers the requests that need no preflight.
    if (pathname.startsWith(`${API_PREFIX}/`) && !isSameOriginRequest(req)) {
      refuse(res);

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

// Only a vault on disk can change outside the app. The sample vault lives in memory.
if (vaultPath !== undefined && vaultPath.length > 0) {
  startVaultSync({ dataAccess, vaultPath: path.resolve(vaultPath), changes: vaultChanges });
}

server.listen(port, () => {
  console.log(`harwex-notes-backend listening on http://localhost:${port}`);
  console.log(`  api:    http://localhost:${port}${API_PREFIX}`);
  console.log(`  static: ${staticDir}`);
  console.log(`  state:  ${stateDbLocation}`);
});
