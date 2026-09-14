import { mcpLaunch, serverName } from "./launch.js";
import type { McpConfigOptions } from "./launch.js";

/**
 * The Codex side. Codex reads `~/.codex/config.toml`, where every server is a
 * `[mcp_servers.<name>]` table. Blender takes its time to open a file and a
 * render is not quick either, so both timeouts are raised from their
 * defaults.
 */

interface CodexMcpServer {
  command: string;
  args: string[];
  env: Record<string, string>;
  startup_timeout_sec: number;
  tool_timeout_sec: number;
}

interface CodexMcpConfig {
  mcp_servers: Record<string, CodexMcpServer>;
}

interface CodexOptions extends McpConfigOptions {
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
}

const STARTUP_TIMEOUT_SEC = 120;
const TOOL_TIMEOUT_SEC = 600;

function codexMcpConfig(options: CodexOptions): CodexMcpConfig {
  const launch = mcpLaunch(options);
  return {
    mcp_servers: {
      [serverName(options)]: {
        command: launch.command,
        args: launch.args,
        env: launch.env,
        startup_timeout_sec: options.startupTimeoutSec ?? STARTUP_TIMEOUT_SEC,
        tool_timeout_sec: options.toolTimeoutSec ?? TOOL_TIMEOUT_SEC,
      },
    },
  };
}

/** A TOML basic string. JSON's escapes are a subset of TOML's. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

/** The block to paste into `~/.codex/config.toml`. */
function codexMcpToml(options: CodexOptions): string {
  const config = codexMcpConfig(options);
  const name = serverName(options);
  const server = config.mcp_servers[name];
  if (!server) {
    throw new Error(`No server named ${name} in the generated config.`);
  }
  const lines = [
    `[mcp_servers.${name}]`,
    `command = ${tomlString(server.command)}`,
    `args = [${server.args.map(tomlString).join(", ")}]`,
    `startup_timeout_sec = ${server.startup_timeout_sec}`,
    `tool_timeout_sec = ${server.tool_timeout_sec}`,
  ];
  const env = Object.entries(server.env);
  if (env.length > 0) {
    lines.push("", `[mcp_servers.${name}.env]`);
    for (const [key, value] of env) {
      lines.push(`${key} = ${tomlString(value)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export type { CodexMcpConfig, CodexMcpServer, CodexOptions };
export { codexMcpConfig, codexMcpToml };
