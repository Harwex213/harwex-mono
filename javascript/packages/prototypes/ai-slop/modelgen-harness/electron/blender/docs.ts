import { spawn } from "node:child_process";
import path from "node:path";

/**
 * The three documentation tools of the Blender MCP server search RST files
 * bundled in the blender_mcp checkout, with Python code that lives in that
 * checkout. Rather than port it, the harness runs the very same tool function
 * in a short-lived Python: `uv run` inside `mcp/` has the dependencies, and a
 * stand-in for FastMCP captures the function the module registers.
 */

const DOC_TOOLS = new Set(["search_api_docs", "search_manual_docs", "get_python_api_docs"]);
const TIMEOUT_MS = 60_000;

const SCRIPT = `
import json, sys
name, args = json.loads(sys.stdin.read())
sys.path.insert(0, ".")
module = __import__("blmcp.tools." + name, fromlist=["register"])
class _Capture:
    fn = None
    def tool(self, *a, **kw):
        def deco(fn):
            self.fn = fn
            return fn
        return deco
capture = _Capture()
module.register(capture)
print(json.dumps(capture.fn(**args), default=str))
`;

async function runDocTool(
  mcpDir: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!DOC_TOOLS.has(toolName)) {
    throw new Error(`${toolName} is not a documentation tool.`);
  }
  const cwd = path.join(mcpDir, "mcp");
  return await new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "--quiet", "python", "-c", SCRIPT], {
      cwd,
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
          `Could not run uv in ${cwd}: ${error.message}. The documentation tools need uv and the blender_mcp checkout from settings.`,
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
