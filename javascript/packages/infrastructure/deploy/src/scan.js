// Finds the workspaces that ask to be deployed. A workspace opts in with an
// `hwDeploy` field in its package.json:
//
//   "hwDeploy": { "route": "/faenwald-battle" }
//
// The route is the URL path the site is served under. The site must load its
// files by relative paths, because the same bundle sits under that path.
//
// An API opts in with an `hwApi` field:
//
//   "hwApi": { "name": "cs-map-picker" }
//
// It runs as container api-<name>, and nginx serves it at /<name>/api/ with no
// per-API config (see nginx.conf). src/deploy-api.js ships it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROUTE_PATTERN = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;
// One path segment: the name becomes both the container name and the URL prefix.
const API_NAME_PATTERN = /^[a-z0-9-]+$/;

const MONOREPO_ROOT = resolve(import.meta.dirname, "../../../..");

function listWorkspaces() {
  const output = execFileSync("yarn", ["workspaces", "list", "--json"], {
    cwd: MONOREPO_ROOT,
    encoding: "utf8",
  });
  return output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function readPackages() {
  return listWorkspaces().map((workspace) => {
    const dir = join(MONOREPO_ROOT, workspace.location);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return { dir, pkg };
  });
}

function validateRoutes(sites) {
  for (const site of sites) {
    if (!ROUTE_PATTERN.test(site.route)) {
      throw new Error(`${site.name}: route "${site.route}" must look like /some-site, lowercase letters, digits and dashes`);
    }
  }
  // A route inside another route would put one bundle inside the directory of
  // the other, and the two sites would overwrite each other's files.
  for (const a of sites) {
    for (const b of sites) {
      if (a === b) {
        continue;
      }
      if (a.route === b.route || b.route.startsWith(`${a.route}/`)) {
        throw new Error(`${a.name} (${a.route}) and ${b.name} (${b.route}) claim overlapping routes`);
      }
    }
  }
}

function scanSites() {
  const sites = [];
  for (const { dir, pkg } of readPackages()) {
    if (!pkg.hwDeploy) {
      continue;
    }
    if (!pkg.scripts?.build) {
      throw new Error(`${pkg.name}: has hwDeploy but no build script`);
    }
    sites.push({
      name: pkg.name,
      title: pkg.description ?? pkg.name,
      dir,
      route: pkg.hwDeploy.route,
    });
  }
  validateRoutes(sites);
  return sites;
}

function scanApis() {
  const apis = [];
  for (const { dir, pkg } of readPackages()) {
    if (!pkg.hwApi) {
      continue;
    }
    const apiName = pkg.hwApi.name;
    if (!API_NAME_PATTERN.test(apiName ?? "")) {
      throw new Error(`${pkg.name}: hwApi.name "${apiName}" must be lowercase letters, digits and dashes`);
    }
    if (!pkg.scripts?.start) {
      throw new Error(`${pkg.name}: has hwApi but no start script`);
    }
    // The image installs dependencies with npm, outside the monorepo, so a
    // workspace package cannot be resolved there.
    const workspaceDeps = Object.entries(pkg.dependencies ?? {}).filter(([, version]) => version.startsWith("workspace:"));
    if (workspaceDeps.length > 0) {
      throw new Error(`${pkg.name}: runtime dependencies from the workspace are not supported: ${workspaceDeps.map(([dep]) => dep).join(", ")}`);
    }
    if (apis.some((api) => api.apiName === apiName)) {
      throw new Error(`${pkg.name}: hwApi.name "${apiName}" is taken by another package`);
    }
    apis.push({ name: pkg.name, apiName, dir, hasBuild: Boolean(pkg.scripts.build) });
  }
  return apis;
}

if (import.meta.main) {
  for (const site of scanSites()) {
    console.log(`site\t${site.route}\t${site.name}`);
  }
  for (const api of scanApis()) {
    console.log(`api\t/${api.apiName}/api/\t${api.name}`);
  }
}

export { MONOREPO_ROOT, scanSites, scanApis };
