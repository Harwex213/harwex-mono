// Builds every deployable site and lays the results out as one web root:
//
//   out/html/index.html              list of the sites
//   out/html/faenwald-battle/...     dist/ of the site with route /faenwald-battle
//
// The Dockerfile copies out/html into nginx as is.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { MONOREPO_ROOT, scanSites } from "./scan.js";

const HTML_DIR = resolve(import.meta.dirname, "../out/html");

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildSite(site) {
  // -R with -t builds the workspace dependencies first. A site such as the
  // Faenwald prototype imports its uikit from the uikit's own dist/.
  // Workspaces without a build script are skipped.
  execFileSync(
    "yarn",
    ["workspaces", "foreach", "--recursive", "--topological", "--from", site.name, "run", "build"],
    { cwd: MONOREPO_ROOT, stdio: "inherit" },
  );
  const dist = join(site.dir, "dist");
  if (!existsSync(join(dist, "index.html"))) {
    throw new Error(`${site.name}: build left no dist/index.html`);
  }
  cpSync(dist, join(HTML_DIR, site.route), { recursive: true });
}

function writeIndex(sites) {
  const items = sites
    .map((site) => `<li><a href="${site.route}/">${escapeHtml(site.title)}</a></li>`)
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta content="width=device-width, initial-scale=1.0" name="viewport">
<title>Sites</title>
</head>
<body>
<ul>
${items}
</ul>
</body>
</html>
`;
  writeFileSync(join(HTML_DIR, "index.html"), html);
}

function bundle() {
  const sites = scanSites();
  if (sites.length === 0) {
    throw new Error("no workspace has an hwDeploy field");
  }
  rmSync(HTML_DIR, { recursive: true, force: true });
  mkdirSync(HTML_DIR, { recursive: true });
  for (const site of sites) {
    console.log(`==> building ${site.name} for ${site.route}`);
    buildSite(site);
  }
  writeIndex(sites);
  return sites;
}

if (import.meta.main) {
  bundle();
}

export { bundle };
