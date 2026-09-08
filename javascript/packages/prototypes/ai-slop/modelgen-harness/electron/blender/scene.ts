import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { execute } from "./process.js";
import { buildToolCall, pythonRepr } from "./toolcode.js";

/**
 * What the harness itself asks Blender for, outside of any agent tool: the
 * glTF the viewer renders, saving, and a preview when the agent forgot to
 * make one.
 *
 * Background Blender has no window, so `bpy.context.active_object` and its
 * friends do not exist and exporters that read them fail. Overriding the
 * context with the window stored in the file brings them back.
 */

const WINDOW_OVERRIDE = [
  "wm = bpy.data.window_managers[0]",
  "win = wm.windows[0] if len(wm.windows) else None",
  "override = bpy.context.temp_override(window=win, screen=win.screen) if win else contextlib.nullcontext()",
].join("\n");

function exportsDir(): string {
  return path.join(app.getPath("userData"), "exports");
}

/** Where the viewer's copy of a file's model lives. Stable per file, so the URL is too. */
function modelPath(blendPath: string): string {
  const hash = createHash("sha1").update(blendPath).digest("hex").slice(0, 16);
  return path.join(exportsDir(), `${hash}.glb`);
}

/** Exports the scene as a binary glTF for the viewer. Resolves to the file, or null when it did not land. */
async function exportModel(blendPath: string): Promise<string | null> {
  await mkdir(exportsDir(), { recursive: true });
  const target = modelPath(blendPath);
  const code = [
    "import bpy, contextlib",
    WINDOW_OVERRIDE,
    "with override:",
    "    bpy.ops.export_scene.gltf(",
    `        filepath=${pythonRepr(target)},`,
    "        export_format='GLB',",
    "        use_selection=False,",
    "        export_apply=True,",
    "        export_cameras=False,",
    "        export_lights=False,",
    "        export_yup=True,",
    "    )",
    "result = {'ok': True}",
  ].join("\n");
  const response = await execute(blendPath, code, true);
  if (response.status !== "ok") {
    throw new Error(`glTF export failed: ${String(response.message ?? "").split("\n").slice(-3).join(" ")}`);
  }
  try {
    const info = await stat(target);
    return info.size > 0 ? target : null;
  } catch {
    return null;
  }
}

/**
 * Writes the file. `bpy.data.is_dirty` is not read back afterwards, and no
 * other part of the harness reads it either: the flag mirrors Blender's
 * window state, which a `--background` Blender never maintains. Edits leave it
 * False, and whatever value a file was written with stays. Studio_v2.blend
 * reads True on load and keeps reading True after a save, which used to leave
 * its tab impossible to close. The harness tracks unsaved changes itself.
 */
async function save(blendPath: string): Promise<void> {
  const response = await execute(
    blendPath,
    `import bpy\nbpy.ops.wm.save_as_mainfile(filepath=${pythonRepr(blendPath)})\nresult = {'ok': True}\n`,
    true,
  );
  if (response.status !== "ok") {
    throw new Error(`Save failed: ${String(response.message ?? "")}`);
  }
}

/**
 * Renders the Blender MCP thumbnail (`render_thumbnail_to_path`) and reads the
 * PNG back. The tool-code writes under Blender's temp dir whatever path it is
 * given, and reports where.
 */
async function renderThumbnail(blendPath: string, name: string): Promise<Uint8Array> {
  const code = await buildToolCall("render_thumbnail_to_path", { output_path: `${name}.png` });
  const response = await execute(blendPath, code, true);
  const result = response.result ?? {};
  if (response.status !== "ok" || result.status !== "ok" || typeof result.filepath !== "string") {
    throw new Error(String(result.message ?? response.message ?? "The render produced no file."));
  }
  return new Uint8Array(await readFile(result.filepath));
}

export { exportModel, modelPath, renderThumbnail, save };
