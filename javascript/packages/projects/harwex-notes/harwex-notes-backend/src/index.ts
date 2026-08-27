import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { FsDataAccess } from "./data-access/fs-data-access.js";
import { createMemoryVaultFs } from "./data-access/memory-vault-fs.js";
import { createNodeVaultFs } from "./data-access/node-vault-fs.js";
import { SAMPLE_VAULT, SAMPLE_VAULT_PATH } from "./data-access/sample-vault.js";
import { appRouter } from "./router/index.js";
import type { TContext } from "./trpc.js";

const DEFAULT_PORT = 3001;

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const vaultPath = process.env.VAULT_PATH;

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

try {
  await dataAccess.preload();
} catch (error) {
  console.error(`Cannot open the vault: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

server.listen(port, () => {
  console.log(`harwex-notes-backend listening on http://localhost:${port}`);
});
