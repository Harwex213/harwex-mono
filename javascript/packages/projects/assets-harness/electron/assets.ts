import { watch } from "node:fs";
import type { Dirent, FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  AssetFile,
  AssetIndex,
  AssetModel,
  AssetTexture,
  AssetTextureSet,
} from "../shared/types.js";

/**
 * Reads a project's `Assets/` directory by its convention:
 *
 * ```
 * Assets/
 *   blender/<Model>.blend        one model per file; <Model>.refs/ and .blend1 backups are skipped
 *   textures/<Model>/            the textures of one model, named after its .blend
 *   material/<Set>/              shared material sets, such as ambientCG downloads
 *   export/<format>/<Model>*.*   fbx, openusd, gltf, glb; the rig JSON sits next to the FBX
 *   references/<category>/       models, models-concepts, scene-concepts, screenshots, render
 *   misc/                        everything else
 * ```
 *
 * The index is what the app draws in its Assets panel and what the agent is
 * told about the project. Whatever does not fit the convention is listed as a
 * warning rather than dropped, so the user sees it.
 */

const DIR_BLENDER = "blender";
const DIR_TEXTURES = "textures";
const DIR_MATERIAL = "material";
const DIR_EXPORT = "export";
const DIR_REFERENCES = "references";
const DIR_MISC = "misc";
const KNOWN_DIRS = new Set([DIR_BLENDER, DIR_TEXTURES, DIR_MATERIAL, DIR_EXPORT, DIR_REFERENCES, DIR_MISC]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".tga", ".tif", ".tiff", ".exr", ".hdr", ".webp", ".bmp"]);

/** Files the scan never lists: OS litter and Blender's own backups. */
const IGNORED = /^(\.DS_Store|Thumbs\.db)$|\.blend\d+$/;

/**
 * The map a texture holds, read off the last token of its name. The tokens are
 * the ones ambientCG, Poly Haven and the `T_<Set>_<Map>` convention use.
 */
const CHANNELS: [RegExp, string][] = [
  [/^(color|basecolor|albedo|diffuse|diff|bc|col)$/i, "base color"],
  [/^(normalgl|normaldx|normal|nor|nor_gl|nor_dx|n|nrm)$/i, "normal"],
  [/^(roughness|rough|r)$/i, "roughness"],
  [/^(metalness|metallic|metal|m)$/i, "metalness"],
  [/^(mg|orm|arm|mr)$/i, "packed"],
  [/^(displacement|disp|height|h)$/i, "displacement"],
  [/^(ambientocclusion|ao|occlusion)$/i, "ambient occlusion"],
  [/^(emission|emissive|e)$/i, "emission"],
  [/^(opacity|alpha|mask)$/i, "opacity"],
];

const WATCH_DEBOUNCE_MS = 600;
/** Deeper than any directory the convention names. */
const MAX_DEPTH = 6;

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function channelOf(fileName: string): string {
  const stem = path.basename(fileName, path.extname(fileName));
  const tokens = stem.split(/[_\-.]/).filter(Boolean);
  // "wood_table_001_nor_gl_2k": drop a resolution token, then try the last one or two tokens.
  while (tokens.length > 1 && /^\d+k$/i.test(tokens[tokens.length - 1] ?? "")) {
    tokens.pop();
  }
  const last = tokens[tokens.length - 1] ?? "";
  const lastTwo = tokens.slice(-2).join("_");
  for (const [pattern, label] of CHANNELS) {
    if (pattern.test(lastTwo) || pattern.test(last)) {
      return label;
    }
  }
  return "";
}

async function describe(assetsPath: string, file: string): Promise<AssetFile | null> {
  try {
    const info = await stat(file);
    return {
      name: path.basename(file),
      path: file,
      relPath: toPosix(path.relative(assetsPath, file)),
      bytes: info.size,
      modifiedAt: info.mtimeMs,
    };
  } catch {
    return null;
  }
}

/** The entries of a directory, without hidden ones. Empty when the directory is missing. */
async function entriesOf(dir: string): Promise<Dirent[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => !entry.name.startsWith("."));
  } catch {
    return [];
  }
}

/** Every file under `dir`, skipping hidden directories and the `.refs` ones of the harness. */
async function filesUnder(assetsPath: string, dir: string, depth = 0): Promise<AssetFile[]> {
  const found: AssetFile[] = [];
  for (const entry of await entriesOf(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH && !entry.name.endsWith(".refs")) {
        found.push(...(await filesUnder(assetsPath, full, depth + 1)));
      }
      continue;
    }
    if (IGNORED.test(entry.name)) {
      continue;
    }
    const file = await describe(assetsPath, full);
    if (file) {
      found.push(file);
    }
  }
  return found.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

async function textureSet(assetsPath: string, dir: string): Promise<AssetTextureSet> {
  const files = await filesUnder(assetsPath, dir);
  const textures: AssetTexture[] = [];
  const others: AssetFile[] = [];
  for (const file of files) {
    if (IMAGE_EXTENSIONS.has(path.extname(file.name).toLowerCase())) {
      textures.push({ ...file, channel: channelOf(file.name) });
    } else {
      others.push(file);
    }
  }
  return { name: path.basename(dir), relPath: toPosix(path.relative(assetsPath, dir)), textures, others };
}

async function textureSetsIn(assetsPath: string, dir: string): Promise<AssetTextureSet[]> {
  const sets: AssetTextureSet[] = [];
  for (const entry of await entriesOf(dir)) {
    if (entry.isDirectory()) {
      sets.push(await textureSet(assetsPath, path.join(dir, entry.name)));
    }
  }
  return sets.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The model an export belongs to: the longest model name the file's stem
 * starts with, followed by nothing or by `_`. The longest one wins, because
 * `Studio_v2.fbx` belongs to `Studio_v2` and not to `Studio`.
 */
function ownerOf(fileName: string, modelNames: string[]): string | null {
  const stem = path.basename(fileName, path.extname(fileName));
  let best: string | null = null;
  for (const name of modelNames) {
    if (stem === name || stem.startsWith(`${name}_`)) {
      if (best === null || name.length > best.length) {
        best = name;
      }
    }
  }
  return best;
}

async function scanAssets(projectPath: string): Promise<AssetIndex> {
  const assetsPath = path.join(projectPath, "Assets");
  const index: AssetIndex = {
    projectPath,
    assetsPath,
    exists: false,
    scannedAt: Date.now(),
    models: [],
    materials: [],
    orphanTextures: [],
    orphanExports: [],
    references: [],
    miscCount: 0,
    warnings: [],
  };
  try {
    if (!(await stat(assetsPath)).isDirectory()) {
      index.warnings.push("Assets is a file, not a directory.");
      return index;
    }
  } catch {
    index.warnings.push("The project has no Assets directory. Opening a model creates Assets/blender/.");
    return index;
  }
  index.exists = true;

  const top = await entriesOf(assetsPath);
  for (const entry of top) {
    if (entry.isDirectory() && !KNOWN_DIRS.has(entry.name)) {
      index.warnings.push(`Assets/${entry.name}/ is not a directory the convention names.`);
    }
    if (entry.isFile() && !IGNORED.test(entry.name)) {
      index.warnings.push(`Assets/${entry.name} sits at the top of Assets, outside every category.`);
    }
  }

  // Models: one .blend per model, directly under blender/.
  const blenderDir = path.join(assetsPath, DIR_BLENDER);
  for (const entry of await entriesOf(blenderDir)) {
    const full = path.join(blenderDir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.endsWith(".refs")) {
        index.warnings.push(`Assets/blender/${entry.name}/ — models belong directly in blender/, one .blend each.`);
      }
      continue;
    }
    if (IGNORED.test(entry.name)) {
      continue;
    }
    if (path.extname(entry.name).toLowerCase() !== ".blend") {
      index.warnings.push(`Assets/blender/${entry.name} is not a .blend.`);
      continue;
    }
    const file = await describe(assetsPath, full);
    if (!file) {
      continue;
    }
    index.models.push({
      name: path.basename(entry.name, ".blend"),
      blendPath: full,
      relPath: file.relPath,
      modifiedAt: file.modifiedAt,
      exports: [],
      textures: null,
    });
  }
  index.models.sort((a, b) => a.name.localeCompare(b.name));
  const byName = new Map<string, AssetModel>(index.models.map((model) => [model.name, model]));
  const names = [...byName.keys()];

  // Textures: textures/<Model>/, matched to the .blend of the same name.
  for (const set of await textureSetsIn(assetsPath, path.join(assetsPath, DIR_TEXTURES))) {
    const model = byName.get(set.name);
    if (model) {
      model.textures = set;
    } else {
      index.orphanTextures.push(set);
    }
  }
  for (const entry of await entriesOf(path.join(assetsPath, DIR_TEXTURES))) {
    if (entry.isFile() && !IGNORED.test(entry.name)) {
      index.warnings.push(`Assets/textures/${entry.name} — textures go into textures/<Model>/.`);
    }
  }

  // Shared material sets.
  index.materials = await textureSetsIn(assetsPath, path.join(assetsPath, DIR_MATERIAL));

  // Exports, matched to their model by name.
  for (const file of await filesUnder(assetsPath, path.join(assetsPath, DIR_EXPORT))) {
    const owner = ownerOf(file.name, names);
    const model = owner ? byName.get(owner) : undefined;
    if (model) {
      model.exports.push(file);
    } else {
      index.orphanExports.push(file);
    }
  }

  // References, one group per category directory.
  const referencesDir = path.join(assetsPath, DIR_REFERENCES);
  for (const entry of await entriesOf(referencesDir)) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join(referencesDir, entry.name);
    const files = (await filesUnder(assetsPath, dir)).filter((file) => {
      return IMAGE_EXTENSIONS.has(path.extname(file.name).toLowerCase());
    });
    index.references.push({ category: entry.name, relPath: toPosix(path.relative(assetsPath, dir)), files });
  }
  index.references.sort((a, b) => a.category.localeCompare(b.category));

  index.miscCount = (await filesUnder(assetsPath, path.join(assetsPath, DIR_MISC))).length;
  return index;
}

// ---------------------------------------------------------------------------
// What the agent is told. The panel shows the index; the agent gets the same
// index as text, cut down to what a modelling run needs.

function listLine(files: { name: string }[], max: number): string {
  const names = files.slice(0, max).map((file) => file.name);
  const rest = files.length - names.length;
  return rest > 0 ? `${names.join(", ")} … (+${rest})` : names.join(", ");
}

function channelsOf(set: AssetTextureSet): string {
  const channels = [...new Set(set.textures.map((texture) => texture.channel).filter(Boolean))];
  return channels.length > 0 ? ` [${channels.join(", ")}]` : "";
}

/** The index as the `<project-assets>` block of the run's instructions. */
function describeAssets(index: AssetIndex, blendPath: string): string {
  const lines: string[] = ["<project-assets>"];
  lines.push(`project: ${index.projectPath}`);
  lines.push(`assets directory: ${index.assetsPath}`);
  const current = index.models.find((model) => model.blendPath === blendPath);
  const currentName = current?.name ?? path.basename(blendPath, ".blend");
  lines.push("");
  lines.push(`the model of this tab: ${currentName}`);
  lines.push(`  blend: ${blendPath}`);
  lines.push(`  its textures go to: ${path.join(index.assetsPath, DIR_TEXTURES, currentName)}/`);
  if (current?.textures) {
    lines.push(`  textures there now: ${listLine(current.textures.textures, 40) || "none"}`);
  } else {
    lines.push("  textures there now: none (the directory does not exist yet)");
  }
  if (current && current.exports.length > 0) {
    lines.push(`  exports: ${current.exports.map((file) => file.relPath).join(", ")}`);
  } else {
    lines.push("  exports: none");
  }
  lines.push("");
  lines.push(`other models in Assets/blender/ (${index.models.length - (current ? 1 : 0)}):`);
  for (const model of index.models) {
    if (model === current) {
      continue;
    }
    const parts = [];
    if (model.textures) {
      parts.push(`${model.textures.textures.length} textures`);
    }
    if (model.exports.length > 0) {
      parts.push(`exports ${model.exports.map((file) => file.name).join(", ")}`);
    }
    lines.push(`  ${model.name}${parts.length > 0 ? ` — ${parts.join("; ")}` : ""}`);
  }
  if (index.materials.length > 0) {
    lines.push("");
    lines.push(`shared material sets in Assets/material/ (reuse before downloading a new one):`);
    for (const set of index.materials) {
      lines.push(`  ${set.name}${channelsOf(set)}: ${listLine(set.textures, 8)}`);
    }
  }
  if (index.references.length > 0) {
    lines.push("");
    lines.push("reference images in Assets/references/:");
    for (const group of index.references) {
      lines.push(`  ${group.category}/: ${group.files.length} images`);
    }
  }
  if (index.warnings.length > 0) {
    lines.push("");
    lines.push("does not follow the convention (leave it unless the user asks):");
    for (const warning of index.warnings.slice(0, 20)) {
      lines.push(`  ${warning}`);
    }
  }
  lines.push("</project-assets>");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Watching. The agent writes textures and exports into the project while it
// works, and the user drops files in by hand, so the panel follows the disk.

let watcher: FSWatcher | null = null;
let timer: NodeJS.Timeout | null = null;

/** Calls `changed` once the Assets directory has been quiet for a moment after a change. */
function watchAssets(assetsPath: string, changed: () => void): void {
  unwatchAssets();
  try {
    watcher = watch(assetsPath, { recursive: true }, (_event, file) => {
      if (typeof file === "string" && IGNORED.test(path.basename(file))) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        changed();
      }, WATCH_DEBOUNCE_MS);
    });
    watcher.on("error", () => {
      unwatchAssets();
    });
  } catch {
    // No Assets directory yet. The rescan after the first model is created starts the watch.
    watcher = null;
  }
}

function unwatchAssets(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  watcher?.close();
  watcher = null;
}

function isWatching(): boolean {
  return watcher !== null;
}

export { channelOf, describeAssets, isWatching, ownerOf, scanAssets, unwatchAssets, watchAssets };
