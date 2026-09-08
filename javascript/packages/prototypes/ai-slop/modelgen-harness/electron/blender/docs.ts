import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The three documentation tools of the Blender MCP server search RST files
 * with Python code. Rather than port it, the harness ships that slice of the
 * server under `vendor/blender-mcp/python` — the tool modules, their RST
 * files and docutils — and runs the very same tool function in a short-lived
 * Python. `run_doc_tool.py` there does the calling; nothing has to be
 * installed but a `python3`.
 */

const DOC_TOOLS = new Set(["search_api_docs", "search_manual_docs", "get_python_api_docs"]);
const TIMEOUT_MS = 60_000;

/** `dist/electron/blender` at run time, so the package root is three up. */
const here = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_DIR = path.join(here, "..", "..", "..", "vendor", "blender-mcp", "python");
const RUNNER = path.join(PYTHON_DIR, "run_doc_tool.py");
const PYTHON = process.env.MODELGEN_PYTHON ?? "python3";

async function runDocTool(toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!DOC_TOOLS.has(toolName)) {
    throw new Error(`${toolName} is not a documentation tool.`);
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [RUNNER], {
      cwd: PYTHON_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${toolName} took longer than ${TIMEOUT_MS / 1000}s.`));
    }, TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Could not run ${PYTHON}: ${error.message}. ` +
            "The documentation tools need a python3 on PATH; set MODELGEN_PYTHON to point at one.",
        ),
      );
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${toolName} failed (exit ${code}): ${err.trim().slice(-1200)}`));
        return;
      }
      try {
        resolve(JSON.parse(out) as Record<string, unknown>);
      } catch (error) {
        reject(new Error(`${toolName} returned no JSON: ${(error as Error).message}\n${out.slice(0, 400)}`));
      }
    });
    child.stdin.end(JSON.stringify([toolName, args]));
  });
}

export { runDocTool };
