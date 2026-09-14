import { mcpLaunch, serverName } from "./launch.js";
import type { McpConfigOptions } from "./launch.js";

/**
 * The Claude Code side. Its `.mcp.json` — and `~/.claude.json`, and the
 * `--mcp-config` flag — all take the same `mcpServers` object, so one shape
 * covers every place a user might put it.
 */

interface ClaudeCodeServer {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface ClaudeCodeMcpConfig {
  mcpServers: Record<string, ClaudeCodeServer>;
}

function claudeCodeMcpConfig(options: McpConfigOptions): ClaudeCodeMcpConfig {
  const launch = mcpLaunch(options);
  return {
    mcpServers: {
      [serverName(options)]: {
        type: "stdio",
        command: launch.command,
        args: launch.args,
        env: launch.env,
      },
    },
  };
}

/** The same config as the text of a `.mcp.json`. */
function claudeCodeMcpJson(options: McpConfigOptions): string {
  return `${JSON.stringify(claudeCodeMcpConfig(options), null, 2)}\n`;
}

/** The one-liner that registers the server without editing a file by hand. */
function claudeCodeAddCommand(options: McpConfigOptions): string {
  const config = claudeCodeMcpConfig(options);
  const name = serverName(options);
  const server = config.mcpServers[name];
  return `claude mcp add-json ${name} '${JSON.stringify(server)}'`;
}

export type { ClaudeCodeMcpConfig, ClaudeCodeServer };
export { claudeCodeAddCommand, claudeCodeMcpConfig, claudeCodeMcpJson };
