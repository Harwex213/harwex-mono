/**
 * A headless Blender behind the Blender MCP tool set.
 *
 * Three ways in:
 *  - `createSession` holds one background Blender open and hands out the
 *    tools bound to it;
 *  - `createMcpServer` / `serveStdio` put those tools on an MCP server;
 *  - `claudeCodeMcpConfig` and `codexMcpConfig` write the block that makes
 *    Claude Code or Codex spawn that server.
 *
 * A session needs no `.blend` to exist. Started without one it opens nothing
 * until `session.open` — or the agent's `open_blend_file` tool — names a
 * file, so one registered server serves every project.
 */

export type { BlenderResponse } from "./blender/client.js";
export type { BlenderInstance } from "./blender/process.js";
export type { Png } from "./blender/png.js";
export type { ParamValue } from "./blender/toolcode.js";
export type { BlenderStatus, SceneCollection, SceneObject, SceneOutline } from "./blender/types.js";
export type { ClaudeCodeMcpConfig, ClaudeCodeServer } from "./config/claude-code.js";
export type { CodexMcpConfig, CodexMcpServer, CodexOptions } from "./config/codex.js";
export type { McpConfigOptions, McpLaunch } from "./config/launch.js";
export type { BlenderSession, SessionOptions } from "./session.js";
export type { InstallOptions, InstalledCli } from "./install.js";
export type { ToolContext, ToolDefinition, ToolResult } from "./tools.js";

export { runBlenderCli, withSyncedBlend } from "./blender/cli.js";
export { freePort, sendCode, waitForPort } from "./blender/client.js";
export { runDocTool } from "./blender/docs.js";
export {
  BLENDER_SKILL_PATH,
  CLI_ENTRY,
  PACKAGE_ROOT,
  PYTHON_DIR,
  SKILLS_DIR,
  TOOLS_DIR,
  VENDOR_DIR,
} from "./blender/paths.js";
export { readPng } from "./blender/png.js";
export { ensureBlendFile, execute, get, onStatus, start, stop, stopAll } from "./blender/process.js";
export { exportModel, exportsDir, modelPath, readOutline, renderThumbnail, save, setExportsDir } from "./blender/scene.js";
export { buildToolCall, pythonRepr } from "./blender/toolcode.js";
export { claudeCodeAddCommand, claudeCodeMcpConfig, claudeCodeMcpJson } from "./config/claude-code.js";
export { codexMcpConfig, codexMcpToml } from "./config/codex.js";
export { DEFAULT_SERVER_NAME, mcpLaunch } from "./config/launch.js";
export { installCli } from "./install.js";
export { createMcpServer, serveStdio } from "./mcp/stdio.js";
export { CLI_NAME, ENV_BLEND, ENV_BLENDER, ENV_PYTHON, SERVER_NAME, SERVER_VERSION } from "./meta.js";
export { createSession, defaultBlenderPath } from "./session.js";
export { buildTools, NO_FILE } from "./tools.js";
