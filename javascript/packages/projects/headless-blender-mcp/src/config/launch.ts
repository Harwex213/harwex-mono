import path from "node:path";
import { CLI_ENTRY } from "../blender/paths.js";
import { ENV_BLENDER, ENV_PYTHON } from "../meta.js";
import { defaultBlenderPath } from "../session.js";

/**
 * How a host is told to start this server. Claude Code and Codex both take a
 * command, its arguments and its environment; only the file they are written
 * into differs.
 *
 * `blendPath` is optional, and leaving it out is the usual case. A server
 * registered without one opens no file until an agent calls
 * `open_blend_file`, so the same registration serves every project. Naming a
 * file pins the server to it and opens it at startup.
 */

interface McpConfigOptions {
  /** The `.blend` the server opens at startup. Left out, the agent opens one itself. */
  blendPath?: string;
  /** The name the host knows the server by. Default `blender`. */
  serverName?: string;
  /** The Blender executable. Defaults to the one this machine would use. */
  blenderPath?: string;
  /** A `python3` for the documentation tools, when the one on PATH will not do. */
  pythonPath?: string;
  /** Override the launcher. Default: `node` on the built CLI of this package. */
  command?: string;
  /** Arguments before the server's own; the `serve` arguments are appended. */
  commandArgs?: string[];
  /** Extra environment for the server process. */
  env?: Record<string, string>;
}

interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const DEFAULT_SERVER_NAME = "blender";

/** The command line a host runs to get this server on its stdio. */
function mcpLaunch(options: McpConfigOptions): McpLaunch {
  const command = options.command ?? process.execPath;
  const head = options.commandArgs ?? (options.command ? [] : [CLI_ENTRY]);
  const args = [...head, "serve"];
  if (options.blendPath && options.blendPath.length > 0) {
    args.push("--blend", path.resolve(options.blendPath));
  }
  const env: Record<string, string> = { ...options.env };
  env[ENV_BLENDER] = options.blenderPath ?? defaultBlenderPath();
  if (options.pythonPath) {
    env[ENV_PYTHON] = options.pythonPath;
  }
  return { command, args, env };
}

function serverName(options: McpConfigOptions): string {
  return options.serverName ?? DEFAULT_SERVER_NAME;
}

export type { McpConfigOptions, McpLaunch };
export { DEFAULT_SERVER_NAME, mcpLaunch, serverName };
