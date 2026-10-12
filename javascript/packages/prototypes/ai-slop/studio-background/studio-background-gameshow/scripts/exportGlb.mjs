// `yarn export-glb`: builds the page, opens the latest scene version headless and writes exports/scene-v<NNN>.glb.
// The page does the export (src/engine/glbExport.ts): the file holds what the scene shows at t = 0 in the Main Wheel
// shot, without hidden objects. `--v 3` exports version 3.
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { fileName, sceneDir } from "./sceneStore.mjs";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = join(PACKAGE_DIR, "dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };

function pickVersion() {
  const at = process.argv.indexOf("--v");
  if (at !== -1) {
    return Number(process.argv[at + 1]);
  }
  return JSON.parse(readFileSync(join(sceneDir(), "index.json"), "utf8")).latest;
}

function serveDist() {
  const server = createServer((request, response) => {
    const path = join(DIST_DIR, decodeURIComponent(new URL(request.url, "http://x").pathname));
    const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "index.html") : path;
    if (!file.startsWith(DIST_DIR) || !existsSync(file)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      done(server);
    });
  });
}

// Counts of the GLB: nodes, meshes, materials and triangles (instances counted).
function describe(glb) {
  const length = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + length).toString("utf8"));
  let triangles = 0;
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) {
      continue;
    }
    const instancing = node.extensions?.EXT_mesh_gpu_instancing;
    const copies = instancing ? json.accessors[Object.values(instancing.attributes)[0]].count : 1;
    for (const primitive of json.meshes[node.mesh].primitives) {
      if ((primitive.mode ?? 4) !== 4) {
        continue;
      }
      const count = primitive.indices !== undefined ? json.accessors[primitive.indices].count : json.accessors[primitive.attributes.POSITION].count;
      triangles += (count / 3) * copies;
    }
  }
  return { json, nodes: json.nodes?.length ?? 0, meshes: json.meshes?.length ?? 0, materials: json.materials?.length ?? 0, triangles };
}

const version = pickVersion();
const server = await serveDist();
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (error) => {
    console.error("[page]", error.message);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?solo&shot=wheel&t=0&v=${version}`);
  await page.waitForFunction(() => window.__studio !== undefined, null, { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const { glb, approximated, lost } = await window.__studio.exportGlb();
    const bytes = new Uint8Array(glb);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { base64: btoa(binary), approximated, lost };
  });
  const glb = Buffer.from(result.base64, "base64");
  const out = join(PACKAGE_DIR, "exports", `scene-v${fileName(version).replace(".json", "")}.glb`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, glb);
  const { nodes, meshes, materials, triangles } = describe(glb);
  console.log(`${out}: ${(glb.length / 1048576).toFixed(2)} MB, ${nodes} nodes, ${meshes} meshes, ${materials} materials, ${Math.round(triangles)} triangles`);
  console.log(`approximated: ${result.approximated.join("; ") || "none"}`);
  console.log(`left out: ${result.lost.join("; ") || "none"}`);
} finally {
  await browser.close();
  server.close();
}
