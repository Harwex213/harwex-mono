import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The bundled Blender MCP tools are Python files that run inside Blender:
 * `mcp/blmcp/tools/<tool>_toolcode.py` in the blender_mcp checkout. This
 * module rebuilds the exact code string the MCP server would send —
 * `tools_helpers/__init__.py` in Node — so the harness runs the same tool-code
 * against its headless Blender, and a newer checkout is picked up without a
 * change here.
 */

const PARAMS_PLACEHOLDER = "__BLMCP_PARAMS__";
const INCLUDE_BEGIN = "# @include_begin: ";
const INCLUDE_END = "# @include_end";

const FOOTER = [
  "",
  `_rv = main(${PARAMS_PLACEHOLDER})`,
  "if callable(_rv):",
  "    check_is_finished = _rv",
  "    result = {}",
  "else:",
  "    result = _rv._asdict()",
  "",
].join("\n");

type ParamValue = string | number | boolean | null;

function toolsDir(mcpDir: string): string {
  return path.join(mcpDir, "mcp", "blmcp", "tools");
}

/** `repr()` of a Python value, for the handful of types tool parameters use. */
function pythonRepr(value: ParamValue): string {
  if (value === null) {
    return "None";
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "None";
  }
  // JSON string escapes are valid Python string escapes.
  return JSON.stringify(value);
}

async function expandIncludes(toolcodePath: string): Promise<string> {
  const raw = await readFile(toolcodePath, "utf8");
  const dir = path.dirname(toolcodePath);
  const out: string[] = [];
  let skipping = false;
  for (const line of raw.split(/(?<=\n)/)) {
    if (line.startsWith(INCLUDE_BEGIN)) {
      const name = line.slice(INCLUDE_BEGIN.length).trim();
      let included = await readFile(path.join(dir, name), "utf8");
      if (!included.endsWith("\n")) {
        included += "\n";
      }
      out.push(included);
      skipping = true;
      continue;
    }
    if (skipping) {
      if (line.startsWith(INCLUDE_END)) {
        skipping = false;
      }
      continue;
    }
    out.push(line);
  }
  return out.join("");
}

/**
 * The code for one bundled tool, ready to send with `strict_json: true`.
 * `params` is null for a tool that takes nothing, otherwise the fields of its
 * `Params` named tuple.
 */
async function buildToolCall(
  mcpDir: string,
  toolName: string,
  params: Record<string, ParamValue> | null,
): Promise<string> {
  const file = path.join(toolsDir(mcpDir), `${toolName}_toolcode.py`);
  let code: string;
  try {
    code = await expandIncludes(file);
  } catch (error) {
    throw new Error(
      `Cannot read the Blender MCP tool-code at ${file}: ${(error as Error).message}. ` +
        "Point the blender_mcp directory in settings at a checkout of https://projects.blender.org/lab/blender_mcp.",
    );
  }
  const literal =
    params === null
      ? "None"
      : `Params(${Object.entries(params)
          .map(([key, value]) => `${key}=${pythonRepr(value)}`)
          .join(", ")})`;
  return `${code}${FOOTER}`.replace(PARAMS_PLACEHOLDER, literal);
}

export type { ParamValue };
export { buildToolCall, pythonRepr };
