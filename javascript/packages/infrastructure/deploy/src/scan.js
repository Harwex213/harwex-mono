// Finds the workspaces that ask to be deployed. A workspace opts in with an
// `hwDeploy` field in its package.json:
//
//   "hwDeploy": { "route": "/faenwald-battle" }
//
// The route is the URL path the site is served under. The site must load its
// files by relative paths, because the same bundle sits under that path.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROUTE_PATTERN = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;

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
  for (const workspace of listWorkspaces()) {
    const dir = join(MONOREPO_ROOT, workspace.location);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
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

if (import.meta.main) {
  for (const site of scanSites()) {
    console.log(`${site.route}\t${site.name}`);
  }
}

export { MONOREPO_ROOT, scanSites };
