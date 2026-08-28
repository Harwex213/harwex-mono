import { spawnSync } from "node:child_process";
import { cpSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Where the built app ends up. The backend serves this folder as its web root.
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(packageDir, "dist");
const staticDir = path.resolve(packageDir, "../harwex-notes-backend/static");

// The api url baked into the bundle. Override with `API_URL=... yarn build:static`.
const DEFAULT_API_URL = "http://localhost:4001/api";
const apiUrl = process.env.API_URL ?? DEFAULT_API_URL;

console.log(`Building with API_URL=${apiUrl}`);

const build = spawnSync("yarn", ["rspack", "build"], {
  cwd: packageDir,
  stdio: "inherit",
  env: { ...process.env, API_URL: apiUrl },
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

rmSync(staticDir, { recursive: true, force: true });
mkdirSync(staticDir, { recursive: true });
cpSync(distDir, staticDir, { recursive: true });

console.log(`Copied ${distDir} -> ${staticDir}`);
