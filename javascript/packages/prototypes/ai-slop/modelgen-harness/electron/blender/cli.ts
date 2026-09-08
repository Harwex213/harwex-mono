import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { execute, get } from "./process.js";
import { pythonRepr } from "./toolcode.js";

/**
 * The `*_for_cli` tools of the Blender MCP server open a `.blend` in a fresh
 * `blender --background` for one request. This is `tools_helpers/blender_cli.py`
 * in Node, kept so the agent has the same fallbacks as it would over MCP.
 */

const RESULT_PREFIX = "__BLMCP_RESULT__";
const ERROR_PREFIX = "__BLMCP_ERROR__";
const CLI_TIMEOUT_MS = 120_000;

function wrapper(code: string): string {
  return [
    "import json",
    "try:",
    "    _ns = {'result': {}}",
    `    exec(${pythonRepr(code)}, _ns)`,
    "    _result = _ns['result']",
    "    if not isinstance(_result, dict):",
    "        raise TypeError('The `result` variable must be a dict, not ' + type(_result).__name__ + '. Wrap your return value: `result = {\"key\": value}`')",
    `    print(${JSON.stringify(RESULT_PREFIX)} + json.dumps(_result, default=repr))`,
    "except Exception as ex:",
    `    print(${JSON.stringify(ERROR_PREFIX)} + json.dumps(str(ex)))`,
  ].join("\n");
}

async function runBlenderCli(
  blenderPath: string,
  blendFile: string,
  code: string,
): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const child = spawn(blenderPath, ["--background", blendFile, "--python-expr", wrapper(code)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Blender CLI timed out after ${CLI_TIMEOUT_MS / 1000}s`));
    }, CLI_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Blender executable not found at '${blenderPath}': ${error.message}`));
    });
    child.on("exit", () => {
      clearTimeout(timer);
      for (const line of out.split("\n")) {
        if (line.startsWith(RESULT_PREFIX)) {
          resolve(JSON.parse(line.slice(RESULT_PREFIX.length)) as Record<string, unknown>);
          return;
        }
        if (line.startsWith(ERROR_PREFIX)) {
          reject(new Error(`Blender error: ${JSON.parse(line.slice(ERROR_PREFIX.length)) as string}`));
          return;
        }
      }
      reject(new Error(`No result marker in Blender output.\nstdout: ${out.slice(-1500)}\nstderr: ${err.slice(-800)}`));
    });
  });
}

/**
 * When the tab's live Blender has the same file open with unsaved changes, a
 * numbered copy is saved and used, then removed — the CLI run sees what the
 * agent sees. Otherwise the file itself is used.
 *
 * `dirty` comes from the harness, which tracks unsaved changes itself.
 * `bpy.data.is_dirty` cannot answer this: a `--background` Blender never
 * updates it. See the note on `save` in `scene.ts`.
 */
async function withSyncedBlend<T>(
  tabBlendPath: string,
  blendFile: string,
  dirty: boolean,
  body: (file: string) => Promise<T>,
): Promise<T> {
  const instance = get(tabBlendPath);
  if (!instance || instance.status !== "ready" || path.resolve(blendFile) !== path.resolve(tabBlendPath)) {
    return await body(blendFile);
  }
  if (!dirty) {
    return await body(blendFile);
  }
  const parsed = path.parse(blendFile);
  const copy = path.join(parsed.dir, `${parsed.name}_mcp_${Date.now().toString(36)}${parsed.ext}`);
  const saved = await execute(
    tabBlendPath,
    `import bpy\nbpy.ops.wm.save_as_mainfile(filepath=${pythonRepr(copy)}, copy=True)\nresult = {}\n`,
    true,
  );
  if (saved.status !== "ok") {
    throw new Error(String(saved.message ?? "Could not save a copy for the CLI run."));
  }
  try {
    return await body(copy);
  } finally {
    await rm(copy, { force: true });
  }
}

export { runBlenderCli, withSyncedBlend };
